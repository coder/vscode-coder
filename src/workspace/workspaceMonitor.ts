import {
	type ServerSentEvent,
	type Workspace,
	type WorkspaceAgent,
	type WorkspaceAgentLog,
	type WorkspaceAgentLogSource,
} from "coder/site/src/api/typesGenerated";
import { formatDistanceToNowStrict } from "date-fns";
import * as vscode from "vscode";

import {
	createWorkspaceIdentifier,
	errToStr,
	extractAgents,
} from "../api/api-helper";
import {
	recordAgentState,
	recordWorkspaceState,
} from "../instrumentation/workspace";
import {
	areNotificationsDisabled,
	areUpdateNotificationsDisabled,
} from "../settings/notifications";
import { createStatusBarItem } from "../util/statusBar";
import { vscodeProposed } from "../vscodeProposed";

import {
	INITIAL_STATE,
	WorkspaceAgentObserver,
	WorkspaceStateObserver,
} from "./observers";

import type { CoderApi } from "../api/coderApi";
import type { ServiceContainer } from "../core/container";
import type { ContextManager } from "../core/contextManager";
import type { Logger } from "../logging/logger";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { UnidirectionalStream } from "../websocket/eventStreamConnection";

const stateVerb = (from: string | undefined) =>
	from === undefined ? "state observed" : "state changed";

/**
 * Monitor a single workspace using a WebSocket for events like shutdown and deletion.
 * Notify the user about relevant changes and update contexts as needed. The
 * workspace status is also shown in the status bar menu.
 */
export class WorkspaceMonitor implements vscode.Disposable {
	private socket: UnidirectionalStream<ServerSentEvent> | undefined;
	private disposed = false;

	// How soon in advance to notify about autostop and deletion.
	private readonly autostopNotifyTime = 1000 * 60 * 30; // 30 minutes.
	private readonly deletionNotifyTime = 1000 * 60 * 60 * 24; // 24 hours.

	// Only notify once.
	private notifiedAutostop = false;
	private notifiedDeletion = false;
	private notifiedOutdated = false;
	private notifiedNotRunning = false;
	private notifiedStartupFailure = false;
	private completedInitialSetup = false;
	private connectedAgentId: string | undefined;

	readonly onChange = new vscode.EventEmitter<Workspace>();
	private readonly statusBarItem: vscode.StatusBarItem;

	// For logging.
	private readonly name: string;
	private readonly telemetry: TelemetryReporter;
	private readonly stateObserver = new WorkspaceStateObserver();
	private readonly agentObserver = new WorkspaceAgentObserver();
	private readonly logger: Logger;
	private readonly contextManager: ContextManager;

	private latestWorkspace: Workspace;

	private constructor(
		workspace: Workspace,
		private readonly client: CoderApi,
		container: ServiceContainer,
	) {
		this.logger = container.getLogger();
		this.contextManager = container.getContextManager();
		this.name = createWorkspaceIdentifier(workspace);
		this.telemetry = container.getTelemetryService();
		this.latestWorkspace = workspace;

		const statusBarItem = createStatusBarItem("workspaceUpdate");
		statusBarItem.text = "$(fold-up) Update Workspace";
		statusBarItem.command = "coder.workspace.update";

		// Store so we can update when the workspace data updates.
		this.statusBarItem = statusBarItem;

		this.update(workspace); // Set initial state.
	}

	/**
	 * Factory method to create and initialize a WorkspaceMonitor.
	 * Use this instead of the constructor to properly handle async websocket initialization.
	 */
	static async create(
		workspace: Workspace,
		client: CoderApi,
		container: ServiceContainer,
	): Promise<WorkspaceMonitor> {
		const monitor = new WorkspaceMonitor(workspace, client, container);

		// Initialize websocket connection
		const socket = await client.watchWorkspace(workspace);

		socket.addEventListener("open", () => {
			monitor.logger.info(`Monitoring ${monitor.name}...`);
		});

		socket.addEventListener("message", (event) => {
			try {
				if (event.parseError) {
					monitor.notifyError(event.parseError);
					return;
				}
				// Perhaps we need to parse this and validate it.
				const newWorkspaceData = event.parsedMessage.data as Workspace | null;
				if (newWorkspaceData) {
					monitor.update(newWorkspaceData);
					monitor.maybeNotify(newWorkspaceData);
					monitor.onChange.fire(newWorkspaceData);
				}
			} catch (error) {
				monitor.notifyError(error);
			}
		});

		// Store so we can close in dispose().
		monitor.socket = socket;

		return monitor;
	}

	public markInitialSetupComplete(connectedAgentId: string): void {
		this.connectedAgentId = connectedAgentId;
		this.completedInitialSetup = true;
		this.maybeNotify(this.latestWorkspace);
	}

	/**
	 * Permanently close the websocket.
	 */
	dispose() {
		if (!this.disposed) {
			this.logger.info(`Unmonitoring ${this.name}...`);
			this.statusBarItem.dispose();
			this.socket?.close();
			this.disposed = true;
		}
	}

	private update(workspace: Workspace) {
		this.observeState(workspace);
		this.observeAgents(workspace);
		this.latestWorkspace = workspace;
		this.updateContext(workspace);
		this.updateStatusBar(workspace);
	}

	private observeState(workspace: Workspace) {
		const transition = this.stateObserver.observe(workspace);
		if (!transition) {
			return;
		}
		const verb = stateVerb(transition.from);
		this.logger.info(`Workspace ${this.name} ${verb}`, {
			from: transition.from ?? INITIAL_STATE,
			to: transition.to,
			transition: transition.buildTransition,
			reason: transition.buildReason,
		});
		recordWorkspaceState(this.telemetry, this.name, transition);
	}

	private observeAgents(workspace: Workspace) {
		const { transitions, removed } = this.agentObserver.observe(workspace);
		for (const transition of transitions) {
			const verb = stateVerb(transition.statusFrom);
			this.logger.info(
				`Workspace ${this.name} agent ${transition.agentName} ${verb}`,
				{
					statusFrom: transition.statusFrom ?? INITIAL_STATE,
					statusTo: transition.statusTo,
					lifecycleFrom: transition.lifecycleFrom ?? INITIAL_STATE,
					lifecycleTo: transition.lifecycleTo,
				},
			);
			recordAgentState(this.telemetry, this.name, transition);
		}
		for (const name of removed) {
			this.logger.info(`Workspace ${this.name} agent ${name} removed`);
		}
	}

	private maybeNotify(workspace: Workspace) {
		const cfg = vscode.workspace.getConfiguration();
		if (areNotificationsDisabled(cfg)) {
			return;
		}
		this.maybeNotifyAutostop(workspace);
		if (this.completedInitialSetup) {
			this.maybeNotifyOutdated(workspace, cfg);
			this.maybeNotifyDeletion(workspace);
			this.maybeNotifyNotRunning(workspace);
			this.maybeNotifyStartupFailure(workspace);
		}
	}

	private maybeNotifyAutostop(workspace: Workspace) {
		if (
			workspace.latest_build.status === "running" &&
			workspace.latest_build.deadline &&
			!this.notifiedAutostop &&
			this.isImpending(workspace.latest_build.deadline, this.autostopNotifyTime)
		) {
			const toAutostopTime = formatDistanceToNowStrict(
				new Date(workspace.latest_build.deadline),
			);
			vscode.window.showInformationMessage(
				`${this.name} is scheduled to shut down in ${toAutostopTime}.`,
			);
			this.notifiedAutostop = true;
		}
	}

	private maybeNotifyDeletion(workspace: Workspace) {
		if (
			workspace.deleting_at &&
			!this.notifiedDeletion &&
			this.isImpending(workspace.deleting_at, this.deletionNotifyTime)
		) {
			const toShutdownTime = formatDistanceToNowStrict(
				new Date(workspace.deleting_at),
			);
			vscode.window.showInformationMessage(
				`${this.name} is scheduled for deletion in ${toShutdownTime}.`,
			);
			this.notifiedDeletion = true;
		}
	}

	private maybeNotifyNotRunning(workspace: Workspace) {
		if (
			!this.notifiedNotRunning &&
			workspace.latest_build.status !== "running"
		) {
			this.notifiedNotRunning = true;
			vscodeProposed.window
				.showInformationMessage(
					`${this.name} is no longer running!`,
					{
						detail: `The workspace status is "${workspace.latest_build.status}". Reload the window to reconnect.`,
						modal: true,
						useCustom: true,
					},
					"Reload Window",
				)
				.then((action) => {
					if (!action) {
						return;
					}
					vscode.commands.executeCommand("workbench.action.reloadWindow");
				});
		}
	}

	private maybeNotifyStartupFailure(workspace: Workspace) {
		if (this.notifiedStartupFailure) {
			return;
		}
		const agent = extractAgents(workspace.latest_build.resources).find(
			(a) => a.id === this.connectedAgentId,
		);
		if (
			agent?.lifecycle_state !== "start_error" &&
			agent?.lifecycle_state !== "start_timeout"
		) {
			return;
		}
		this.notifiedStartupFailure = true;
		vscode.window
			.showWarningMessage(
				this.startupFailureMessage(agent),
				"Show Logs",
				"Open in Dashboard",
			)
			.then((action) => {
				if (action === "Show Logs") {
					void this.showStartupLogs(agent);
				} else if (action === "Open in Dashboard") {
					vscode.commands.executeCommand("coder.navigateToWorkspace");
				}
			});
	}

	private startupFailureMessage(agent: WorkspaceAgent): string {
		const where = `agent ${agent.name} in ${this.name}`;
		if (agent.lifecycle_state === "start_timeout") {
			return `Startup scripts on ${where} are taking longer than expected and might still be running.`;
		}
		const failed = agent.scripts
			.filter((s) => s.run_on_start && s.status && s.status !== "ok")
			.map((s) =>
				s.exit_code
					? `"${s.display_name}" (exit code ${s.exit_code})`
					: `"${s.display_name}"`,
			);
		if (failed.length === 0) {
			return `Startup scripts failed on ${where}.`;
		}
		const noun = failed.length === 1 ? "script" : "scripts";
		return `Startup ${noun} ${failed.join(", ")} failed on ${where}.`;
	}

	private async showStartupLogs(agent: WorkspaceAgent) {
		try {
			const logs = await this.client.getWorkspaceAgentLogs(agent.id);
			const writeEmitter = new vscode.EventEmitter<string>();
			const terminal = vscode.window.createTerminal({
				name: `Startup Logs (${agent.name})`,
				pty: {
					onDidWrite: writeEmitter.event,
					open: () =>
						writeEmitter.fire(this.formatAgentLogs(logs, agent.log_sources)),
					close: () => writeEmitter.dispose(),
				},
			});
			terminal.show();
		} catch (error) {
			const message = errToStr(error, "no further details");
			this.logger.warn("Failed to show agent startup logs", error);
			vscode.window.showErrorMessage(`Failed to show startup logs: ${message}`);
		}
	}

	private formatAgentLogs(
		logs: readonly WorkspaceAgentLog[],
		sources: readonly WorkspaceAgentLogSource[],
	): string {
		const names = new Map(sources.map((s) => [s.id, s.display_name]));
		return logs
			.map((log) => {
				const name = names.get(log.source_id);
				const output = log.output.replace(/\r?\n/g, "\r\n");
				return name ? `[${name}] ${output}` : output;
			})
			.join("\r\n");
	}

	private isImpending(target: string, notifyTime: number): boolean {
		const nowTime = Date.now();
		const targetTime = new Date(target).getTime();
		const timeLeft = targetTime - nowTime;
		return timeLeft >= 0 && timeLeft <= notifyTime;
	}

	private maybeNotifyOutdated(
		workspace: Workspace,
		cfg: Pick<vscode.WorkspaceConfiguration, "get">,
	) {
		if (!this.notifiedOutdated && workspace.outdated) {
			if (areUpdateNotificationsDisabled(cfg)) {
				return;
			}

			this.notifiedOutdated = true;

			this.client
				.getTemplate(workspace.template_id)
				.then((template) => {
					return this.client.getTemplateVersion(template.active_version_id);
				})
				.then((version) => {
					const infoMessage = version.message
						? `A new version of your workspace is available: ${version.message}`
						: "A new version of your workspace is available.";
					vscode.window
						.showInformationMessage(infoMessage, "Update")
						.then((action) => {
							if (action === "Update") {
								vscode.commands.executeCommand(
									"coder.workspace.update",
									this.latestWorkspace,
									this.client,
								);
							}
						});
				})
				.catch((error) => {
					this.logger.warn("Failed to check for workspace updates", error);
				});
		}
	}

	private notifyError(error: unknown) {
		// For now, we are not bothering the user about this.
		const message = errToStr(
			error,
			"Got empty error while monitoring workspace",
		);
		this.logger.error(message);
	}

	private updateContext(workspace: Workspace) {
		this.contextManager.set("coder.workspace.updatable", workspace.outdated);
	}

	private updateStatusBar(workspace: Workspace) {
		const status = workspace.latest_build.status;
		const settled =
			status === "running" || status === "stopped" || status === "failed";
		if (workspace.outdated && settled) {
			this.statusBarItem.show();
		} else {
			this.statusBarItem.hide();
		}
	}
}
