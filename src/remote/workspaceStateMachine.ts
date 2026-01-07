import { createWorkspaceIdentifier, extractAgents } from "../api/api-helper";
import {
	startWorkspaceIfStoppedOrFailed,
	streamAgentLogs,
	streamBuildLogs,
} from "../api/workspace";
import { maybeAskAgent } from "../promptUtils";
import { type AuthorityParts } from "../util";

import { TerminalSession } from "./terminalSession";

import type {
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
} from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { CoderApi } from "../api/coderApi";
import type { PathResolver } from "../core/pathResolver";
import type { FeatureSet } from "../featureSet";
import type { Logger } from "../logging/logger";
import type { UnidirectionalStream } from "../websocket/eventStreamConnection";

/**
 * Manages workspace and agent state transitions until ready for SSH connection.
 * Streams build and agent logs, and handles socket lifecycle.
 */
export class WorkspaceStateMachine implements vscode.Disposable {
	private readonly terminal: TerminalSession;

	private agent: { id: string; name: string } | undefined;

	private buildLogSocket: UnidirectionalStream<ProvisionerJobLog> | null = null;

	private agentLogSocket: UnidirectionalStream<WorkspaceAgentLog[]> | null =
		null;

	constructor(
		private readonly parts: AuthorityParts,
		private readonly workspaceClient: CoderApi,
		private readonly firstConnect: boolean,
		private readonly binaryPath: string,
		private readonly featureSet: FeatureSet,
		private readonly logger: Logger,
		private readonly pathResolver: PathResolver,
		private readonly vscodeProposed: typeof vscode,
	) {
		this.terminal = new TerminalSession("Workspace Build");
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
				this.closeBuildLogSocket();
				break;

			case "stopped":
			case "failed": {
				this.closeBuildLogSocket();

				if (!this.firstConnect && !(await this.confirmStart(workspaceName))) {
					throw new Error(`Workspace start cancelled`);
				}

				progress.report({ message: `starting ${workspaceName}...` });
				this.logger.info(`Starting ${workspaceName}`);
				const globalConfigDir = this.pathResolver.getGlobalConfigDir(
					this.parts.safeHostname,
				);
				await startWorkspaceIfStoppedOrFailed(
					this.workspaceClient,
					globalConfigDir,
					this.binaryPath,
					workspace,
					this.terminal.writeEmitter,
					this.featureSet,
				);
				this.logger.info(`${workspaceName} status is now running`);
				return false;
			}

			case "pending":
			case "starting":
			case "stopping":
				// Clear the agent since it's ID could change after a restart
				this.agent = undefined;
				this.closeAgentLogSocket();
				progress.report({
					message: `building ${workspaceName} (${workspace.latest_build.status})...`,
				});
				this.logger.info(`Waiting for ${workspaceName}`);

				this.buildLogSocket ??= await streamBuildLogs(
					this.workspaceClient,
					this.terminal.writeEmitter,
					workspace,
				);
				return false;

			case "deleted":
			case "deleting":
			case "canceled":
			case "canceling":
				this.closeBuildLogSocket();
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
				this.closeAgentLogSocket();
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

				this.agentLogSocket ??= await streamAgentLogs(
					this.workspaceClient,
					this.terminal.writeEmitter,
					agent,
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
				this.closeAgentLogSocket();
				this.logger.info(
					`Agent ${agent.name} startup scripts failed, but continuing`,
				);
				return true;

			case "start_timeout":
				this.closeAgentLogSocket();
				this.logger.info(
					`Agent ${agent.name} startup scripts timed out, but continuing`,
				);
				return true;

			case "shutting_down":
			case "off":
			case "shutdown_error":
			case "shutdown_timeout":
				this.closeAgentLogSocket();
				throw new Error(
					`Invalid lifecycle state '${agent.lifecycle_state}' for ${workspaceName}/${agent.name}`,
				);
		}
	}

	private closeBuildLogSocket(): void {
		if (this.buildLogSocket) {
			this.buildLogSocket.close();
			this.buildLogSocket = null;
		}
	}

	private closeAgentLogSocket(): void {
		if (this.agentLogSocket) {
			this.agentLogSocket.close();
			this.agentLogSocket = null;
		}
	}

	private async confirmStart(workspaceName: string): Promise<boolean> {
		const action = await this.vscodeProposed.window.showInformationMessage(
			`Unable to connect to the workspace ${workspaceName} because it is not running. Start the workspace?`,
			{
				useCustom: true,
				modal: true,
			},
			"Start",
		);
		return action === "Start";
	}

	public getAgentId(): string | undefined {
		return this.agent?.id;
	}

	dispose(): void {
		this.closeBuildLogSocket();
		this.closeAgentLogSocket();
		this.terminal.dispose();
	}
}
