import {
	createWorkspaceIdentifier,
	errToStr,
	extractAgents,
} from "../api/api-helper";
import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "../api/updateParameters";
import {
	LazyStream,
	startWorkspace,
	updateWorkspace,
	streamAgentLogs,
	streamBuildLogs,
} from "../api/workspace";
import { WorkspaceOperationTelemetry } from "../instrumentation/workspace";
import { maybeAskAgent } from "../promptUtils";
import { vscodeProposed } from "../vscodeProposed";

import { TerminalOutputChannel } from "./terminalOutputChannel";

import type {
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
} from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { CoderApi } from "../api/coderApi";
import type { ServiceContainer } from "../core/container";
import type { StartupMode } from "../core/mementoManager";
import type { CliFeatureSet, ServerFeatureSet } from "../featureSet";
import type { Logger } from "../logging/logger";
import type { CliAuth } from "../settings/cli";
import type { AuthorityParts } from "../util/authority";

/**
 * Manages workspace and agent state transitions until ready for SSH connection.
 * Streams build and agent logs, and handles socket lifecycle.
 */
export class WorkspaceStateMachine implements vscode.Disposable {
	private readonly terminal: TerminalOutputChannel;
	private readonly buildLogStream = new LazyStream<ProvisionerJobLog>();
	private readonly agentLogStream = new LazyStream<WorkspaceAgentLog[]>();
	private readonly operationTelemetry: WorkspaceOperationTelemetry;

	private agent: { id: string; name: string } | undefined;
	private workspace: Workspace | undefined;
	/** Stop build we posted, whose start the server queues behind it. */
	private queuedStopBuild: string | undefined;

	private readonly logger: Logger;

	constructor(
		private readonly parts: AuthorityParts,
		private readonly workspaceClient: CoderApi,
		private startupMode: StartupMode,
		private readonly binaryPath: string,
		private readonly cliFeatures: CliFeatureSet,
		private readonly serverFeatures: ServerFeatureSet,
		private readonly cliAuth: CliAuth,
		container: ServiceContainer,
	) {
		this.logger = container.getLogger();
		this.terminal = new TerminalOutputChannel("Coder: Workspace Build");
		const telemetry = container.getTelemetryService();
		const workspaceName = `${parts.username}/${parts.workspace}`;
		this.operationTelemetry = new WorkspaceOperationTelemetry(
			telemetry,
			workspaceName,
		);
	}

	/**
	 * Process workspace state and determine if agent is ready.
	 * Reports progress updates and returns true if ready to connect, false if should wait for next event.
	 */
	async processWorkspace(
		workspace: Workspace,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<boolean> {
		const current = this.workspace?.latest_build;
		// Snapshots taken before the build we posted are stale.
		if (current && workspace.latest_build.build_number < current.build_number) {
			return false;
		}
		if (workspace.latest_build.id !== current?.id) {
			// Logs stream from one build, so a new build needs a new stream.
			this.buildLogStream.close();
		}
		this.workspace = workspace;
		const workspaceName = createWorkspaceIdentifier(workspace);

		switch (workspace.latest_build.status) {
			case "running": {
				this.buildLogStream.close();
				const updated = await this.maybeUpdate(
					workspace,
					workspaceName,
					progress,
				);
				if (!updated) break;
				this.resetAgent();
				if (updated.latest_build.status !== "running") return false;
				workspace = updated;
				break;
			}

			case "stopped":
			case "failed": {
				this.buildLogStream.close();
				if (workspace.latest_build.id === this.queuedStopBuild) {
					if (workspace.latest_build.status === "failed") {
						throw new Error(
							`Update failed for ${workspaceName}. Check the workspace in the dashboard before retrying.`,
						);
					}
					// Starting it here would race the server's queued start.
					progress.report({
						message: `waiting for the server to start ${workspaceName}...`,
					});
					return false;
				}

				if (this.startupMode === "none") {
					const choice = await this.confirmStartOrUpdate(
						workspaceName,
						workspace.outdated,
					);
					if (!choice) {
						throw new Error(`Workspace start cancelled`);
					}
					this.startupMode = choice;
				}

				const updated = await this.maybeUpdate(
					workspace,
					workspaceName,
					progress,
				);
				if (!updated) {
					// Start only when no update was requested.
					await this.triggerStart(workspace, workspaceName, progress);
					return false;
				}
				this.resetAgent();
				if (updated.latest_build.status !== "running") return false;
				workspace = updated;
				break;
			}

			case "pending":
			case "starting":
			case "stopping": {
				// Clear the agent since its ID could change after a restart
				this.resetAgent();
				this.agentLogStream.close();
				progress.report({
					message: `building ${workspaceName} (${workspace.latest_build.status})...`,
				});
				this.logger.info(`Waiting for ${workspaceName}`);

				await this.buildLogStream.open(() =>
					streamBuildLogs(
						this.workspaceClient,
						(line) => this.terminal.write(line + "\r\n"),
						workspace.latest_build.id,
					),
				);
				return false;
			}

			case "deleted":
			case "deleting":
			case "canceled":
			case "canceling":
				this.buildLogStream.close();
				throw new Error(`${workspaceName} is ${workspace.latest_build.status}`);
		}

		const agents = extractAgents(workspace.latest_build.resources);
		if (this.agent === undefined) {
			this.logger.info(`Finding agent for ${workspaceName}`);
			const gotAgent = await maybeAskAgent(agents, this.parts.agent);
			if (!gotAgent) {
				// User declined to pick an agent.
				throw new Error("Agent selection cancelled");
			}
			this.agent = { id: gotAgent.id, name: gotAgent.name };
			this.logger.info(
				`Found agent ${gotAgent.name} with status`,
				gotAgent.status,
			);
		}
		const agent = agents.find((a) => a.id === this.agent?.id);
		if (!agent) {
			throw new Error(
				`Agent ${this.agent.name} not found in ${workspaceName} resources`,
			);
		}

		switch (agent.status) {
			case "connecting":
				progress.report({
					message: `connecting to agent ${agent.name}...`,
				});
				this.logger.debug(`Connecting to agent ${agent.name}`);
				return false;

			case "disconnected":
				throw new Error(`Agent ${workspaceName}/${agent.name} disconnected`);

			case "timeout":
				progress.report({
					message: `agent ${agent.name} timed out, retrying...`,
				});
				this.logger.debug(`Agent ${agent.name} timed out, retrying`);
				return false;

			case "connected":
				break;
		}

		switch (agent.lifecycle_state) {
			case "ready":
				this.agentLogStream.close();
				return true;

			case "starting": {
				const isBlocking = agent.scripts.some(
					(script) => script.start_blocks_login,
				);
				if (!isBlocking) {
					return true;
				}

				progress.report({
					message: `running agent ${agent.name} startup scripts...`,
				});
				this.logger.debug(`Running agent ${agent.name} startup scripts`);

				await this.agentLogStream.open(() =>
					streamAgentLogs(
						this.workspaceClient,
						(line) => this.terminal.write(line + "\r\n"),
						agent.id,
					),
				);
				return false;
			}

			case "created":
				progress.report({
					message: `starting agent ${agent.name}...`,
				});
				this.logger.debug(`Starting agent ${agent.name}`);
				return false;

			case "start_error":
				this.agentLogStream.close();
				this.logger.info(
					`Agent ${agent.name} startup scripts failed, but continuing`,
				);
				return true;

			case "start_timeout":
				this.agentLogStream.close();
				this.logger.info(
					`Agent ${agent.name} startup scripts timed out, but continuing`,
				);
				return true;

			case "shutting_down":
			case "off":
			case "shutdown_error":
			case "shutdown_timeout":
				this.agentLogStream.close();
				throw new Error(
					`Invalid lifecycle state '${agent.lifecycle_state}' for ${workspaceName}/${agent.name}`,
				);
		}
	}

	private buildCliContext(workspace: Workspace) {
		return {
			restClient: this.workspaceClient,
			auth: this.cliAuth,
			binPath: this.binaryPath,
			workspace,
			write: (data: string) => this.terminal.write(data),
			cliFeatures: this.cliFeatures,
			serverFeatures: this.serverFeatures,
		};
	}

	private async triggerStart(
		workspace: Workspace,
		workspaceName: string,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<void> {
		progress.report({ message: `starting ${workspaceName}...` });
		this.logger.info(`Starting ${workspaceName}`, {
			mode: this.startupMode,
			status: workspace.latest_build.status,
		});
		await this.operationTelemetry.traceStart(() =>
			startWorkspace(this.buildCliContext(workspace)),
		);
		this.logger.info(`${workspaceName} start initiated`);
	}

	/** No-op outside update mode; asks before falling back to the old version. */
	private async maybeUpdate(
		workspace: Workspace,
		workspaceName: string,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<Workspace | undefined> {
		if (this.startupMode !== "update") return undefined;
		// Downgrade up-front so monitor events don't retry the update.
		this.startupMode = "start";
		progress.report({ message: `updating ${workspaceName}...` });
		this.logger.info(`Updating ${workspaceName}`, {
			status: workspace.latest_build.status,
		});
		try {
			const parameters = await this.operationTelemetry.traceParametersPrompt(
				() => collectUpdateParameters(this.workspaceClient, workspace),
			);
			const updated = await this.operationTelemetry.traceUpdate(() =>
				updateWorkspace(this.buildCliContext(workspace), parameters),
			);
			this.workspace = updated;
			// Only the one-build update returns a stop; the server starts it after.
			if (updated.latest_build.transition === "stop") {
				this.queuedStopBuild = updated.latest_build.id;
			}
			this.logger.info(`${workspaceName} update initiated`);
			return updated;
		} catch (error) {
			if (error instanceof WorkspaceUpdateCancelledError) {
				this.logger.info(
					`Update cancelled for ${workspaceName}; continuing with the existing version.`,
				);
				return undefined;
			}
			const reason = errToStr(error);
			this.logger.warn(`Update failed for ${workspaceName}: ${reason}`);
			const connect = await this.operationTelemetry.traceFailurePrompt(() =>
				this.confirmConnectToExisting(workspaceName, reason),
			);
			if (!connect) {
				throw error;
			}
			this.logger.info(`Connecting to the existing ${workspaceName} version`);
			return undefined;
		}
	}

	/** Offers the existing version after a failed update. */
	private async confirmConnectToExisting(
		workspaceName: string,
		reason: string,
	): Promise<boolean> {
		const action = "Connect Anyway";
		const choice = await vscodeProposed.window.showWarningMessage(
			`Failed to update ${workspaceName}`,
			{
				useCustom: true,
				modal: true,
				detail: reason,
			},
			action,
		);
		return choice === action;
	}

	private async confirmStartOrUpdate(
		workspaceName: string,
		outdated: boolean,
	): Promise<"start" | "update" | undefined> {
		return this.operationTelemetry.traceStartPrompt(outdated, async () => {
			const buttons = outdated
				? (["Start", "Update and Start"] as const)
				: (["Start"] as const);
			const action = await vscodeProposed.window.showInformationMessage(
				`The workspace ${workspaceName} is not running. How would you like to proceed?`,
				{
					useCustom: true,
					modal: true,
				},
				...buttons,
			);
			if (action === "Start") return "start";
			if (action === "Update and Start") return "update";
			return undefined;
		});
	}

	public getAgentId(): string | undefined {
		return this.agent?.id;
	}

	public getWorkspace(): Workspace | undefined {
		return this.workspace;
	}

	/** Clears the agent; its ID can change across builds. */
	private resetAgent(): void {
		this.agent = undefined;
	}

	dispose(): void {
		this.buildLogStream.close();
		this.agentLogStream.close();
		this.terminal.dispose();
	}
}
