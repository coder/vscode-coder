import { type AuthorityParts } from "src/util";

import { createWorkspaceIdentifier, extractAgents } from "../api/api-helper";
import {
	startWorkspaceIfStoppedOrFailed,
	streamAgentLogs,
	streamBuildLogs,
} from "../api/workspace";
import { maybeAskAgent } from "../promptUtils";

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
import type { OneWayWebSocket } from "../websocket/oneWayWebSocket";

/**
 * Manages workspace and agent state transitions until ready for SSH connection.
 * Streams build and agent logs, and handles socket lifecycle.
 */
export class WorkspaceStateMachine implements vscode.Disposable {
	private readonly terminal: TerminalSession;

	private agentId: string | undefined;

	private buildLogSocket: {
		socket: OneWayWebSocket<ProvisionerJobLog> | null;
		buildId: string | null;
	} = { socket: null, buildId: null };

	private agentLogSocket: OneWayWebSocket<WorkspaceAgentLog[]> | null = null;

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
		this.terminal = new TerminalSession("Agent Log");
	}

	/**
	 * Process workspace state and determine if agent is ready.
	 * Reports progress updates and returns true if ready to connect, false if should wait for next event.
	 */
	async processWorkspace(
		workspace: Workspace,
		progress?: vscode.Progress<{ message?: string }>,
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
					throw new Error(`User declined to start ${workspaceName}`);
				}

				progress?.report({ message: `Starting ${workspaceName}...` });
				this.logger.info(`Starting ${workspaceName}...`);
				const globalConfigDir = this.pathResolver.getGlobalConfigDir(
					this.parts.label,
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
				progress?.report({ message: "Waiting for workspace build..." });
				this.logger.info(`Waiting for ${workspaceName}...`);

				if (!this.buildLogSocket.socket) {
					const socket = await streamBuildLogs(
						this.workspaceClient,
						this.terminal.writeEmitter,
						workspace,
					);
					this.buildLogSocket = {
						socket,
						buildId: workspace.latest_build.id,
					};
				}
				return false;

			case "deleted":
			case "deleting":
			case "canceled":
			case "canceling":
				this.closeBuildLogSocket();
				throw new Error(`${workspaceName} is ${workspace.latest_build.status}`);

			default:
				this.closeBuildLogSocket();
				throw new Error(
					`${workspaceName} unknown status: ${workspace.latest_build.status}`,
				);
		}

		const agents = extractAgents(workspace.latest_build.resources);
		if (this.agentId === undefined) {
			this.logger.info(`Finding agent for ${workspaceName}...`);
			const gotAgent = await maybeAskAgent(agents, this.parts.agent);
			if (!gotAgent) {
				// User declined to pick an agent.
				throw new Error("User declined to pick an agent");
			}
			this.agentId = gotAgent.id;
			this.logger.info(
				`Found agent ${gotAgent.name} with status`,
				gotAgent.status,
			);
		}
		const agent = agents.find((a) => a.id === this.agentId);
		if (!agent) {
			throw new Error(`Agent not found in ${workspaceName} resources`);
		}

		switch (agent.status) {
			case "connecting":
				progress?.report({
					message: `Waiting for agent ${agent.name} to connect...`,
				});
				this.logger.debug(`Waiting for agent ${agent.name}...`);
				return false;

			case "disconnected":
				throw new Error(`${workspaceName}/${agent.name} disconnected`);

			case "timeout":
				progress?.report({
					message: `Agent ${agent.name} timed out, continuing to wait...`,
				});
				this.logger.debug(
					`Agent ${agent.name} timed out, continuing to wait...`,
				);
				return false;

			case "connected":
				break;

			default:
				throw new Error(
					`${workspaceName}/${agent.name} unknown status: ${agent.status}`,
				);
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

				progress?.report({
					message: `Waiting for agent ${agent.name} startup scripts...`,
				});
				this.logger.debug(`Waiting for agent ${agent.name} startup scripts...`);

				this.agentLogSocket ??= await streamAgentLogs(
					this.workspaceClient,
					this.terminal.writeEmitter,
					agent,
				);
				return false;
			}

			case "created":
				progress?.report({
					message: `Waiting for agent ${agent.name} to start...`,
				});
				this.logger.debug(
					`Waiting for ${workspaceName}/${agent.name} to start...`,
				);
				return false;

			case "start_error":
				this.closeAgentLogSocket();
				this.logger.info(
					`Agent ${agent.name} startup script failed, but continuing...`,
				);
				return true;

			case "start_timeout":
				this.closeAgentLogSocket();
				this.logger.info(
					`Agent ${agent.name} startup script timed out, but continuing...`,
				);
				return true;

			case "off":
				this.closeAgentLogSocket();
				throw new Error(`${workspaceName}/${agent.name} is off`);

			default:
				this.closeAgentLogSocket();
				throw new Error(
					`${workspaceName}/${agent.name} unknown lifecycle state: ${agent.lifecycle_state}`,
				);
		}
	}

	private closeBuildLogSocket(): void {
		if (this.buildLogSocket.socket) {
			this.buildLogSocket.socket.close();
			this.buildLogSocket = { socket: null, buildId: null };
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
		return this.agentId;
	}

	dispose(): void {
		this.closeBuildLogSocket();
		this.closeAgentLogSocket();
		this.terminal.dispose();
	}
}
