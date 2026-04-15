import { createWorkspaceIdentifier, extractAgents } from "../api/api-helper";
import {
	LazyStream,
	startWorkspace,
	updateWorkspace,
	streamAgentLogs,
	streamBuildLogs,
} from "../api/workspace";
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
import type { StartupMode } from "../core/mementoManager";
import type { FeatureSet } from "../featureSet";
import type { Logger } from "../logging/logger";
import type { CliAuth } from "../settings/cli";
import type { AuthorityParts } from "../util";

/**
 * Manages workspace and agent state transitions until ready for SSH connection.
 * Streams build and agent logs, and handles socket lifecycle.
 */
export class WorkspaceStateMachine implements vscode.Disposable {
	private readonly terminal: TerminalOutputChannel;
	private readonly buildLogStream = new LazyStream<ProvisionerJobLog>();
	private readonly agentLogStream = new LazyStream<WorkspaceAgentLog[]>();

	private agent: { id: string; name: string } | undefined;

	constructor(
		private readonly parts: AuthorityParts,
		private readonly workspaceClient: CoderApi,
		private startupMode: StartupMode,
		private readonly binaryPath: string,
		private readonly featureSet: FeatureSet,
		private readonly logger: Logger,
		private readonly cliAuth: CliAuth,
	) {
		this.terminal = new TerminalOutputChannel("Coder: Workspace Build");
	}

	/**
	 * Process workspace state and determine if agent is ready.
	 * Reports progress updates and returns true if ready to connect, false if should wait for next event.
	 */
	async processWorkspace(
		workspace: Workspace,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<boolean> {
		const workspaceName = createWorkspaceIdentifier(workspace);

		switch (workspace.latest_build.status) {
			case "running":
				this.buildLogStream.close();
				if (this.startupMode === "update") {
					await this.triggerUpdate(workspace, workspaceName, progress);
					// Agent IDs may have changed after an update.
					this.agent = undefined;
				}
				break;

			case "stopped":
			case "failed": {
				this.buildLogStream.close();

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

				if (this.startupMode === "update") {
					await this.triggerUpdate(workspace, workspaceName, progress);
				} else {
					await this.triggerStart(workspace, workspaceName, progress);
				}
				return false;
			}

			case "pending":
			case "starting":
			case "stopping": {
				// Clear the agent since its ID could change after a restart
				this.agent = undefined;
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
			featureSet: this.featureSet,
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
		await startWorkspace(this.buildCliContext(workspace));
		this.logger.info(`${workspaceName} start initiated`);
	}

	private async triggerUpdate(
		workspace: Workspace,
		workspaceName: string,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<void> {
		progress.report({ message: `updating ${workspaceName}...` });
		this.logger.info(`Updating ${workspaceName}`, {
			mode: this.startupMode,
			status: workspace.latest_build.status,
		});
		await updateWorkspace(this.buildCliContext(workspace));
		// Downgrade so subsequent transitions don't re-trigger the update.
		this.startupMode = "start";
		this.logger.info(`${workspaceName} update initiated`);
	}

	private async confirmStartOrUpdate(
		workspaceName: string,
		outdated: boolean,
	): Promise<"start" | "update" | undefined> {
		const buttons = outdated ? ["Start", "Update and Start"] : ["Start"];
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
	}

	public getAgentId(): string | undefined {
		return this.agent?.id;
	}

	dispose(): void {
		this.buildLogStream.close();
		this.agentLogStream.close();
		this.terminal.dispose();
	}
}
