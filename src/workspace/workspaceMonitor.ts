import {
	type ServerSentEvent,
	type Workspace,
} from "coder/site/src/api/typesGenerated";
import { formatDistanceToNowStrict } from "date-fns";
import * as vscode from "vscode";

import { createWorkspaceIdentifier, errToStr } from "../api/api-helper";
import { type CoderApi } from "../api/coderApi";
import { type ContextManager } from "../core/contextManager";
import { type Logger } from "../logging/logger";
import { vscodeProposed } from "../vscodeProposed";
import { type UnidirectionalStream } from "../websocket/eventStreamConnection";

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
	private completedInitialSetup = false;

	readonly onChange = new vscode.EventEmitter<Workspace>();
	private readonly statusBarItem: vscode.StatusBarItem;

	// For logging.
	private readonly name: string;

	private constructor(
		workspace: Workspace,
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly contextManager: ContextManager,
	) {
		this.name = createWorkspaceIdentifier(workspace);

		const statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			999,
		);
		statusBarItem.name = "Coder Workspace Update";
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
		logger: Logger,
		contextManager: ContextManager,
	): Promise<WorkspaceMonitor> {
		const monitor = new WorkspaceMonitor(
			workspace,
			client,
			logger,
			contextManager,
		);

		// Initialize websocket connection
		const socket = await client.watchWorkspace(workspace);

		socket.addEventListener("open", () => {
			logger.info(`Monitoring ${monitor.name}...`);
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

	public markInitialSetupComplete(): void {
		this.completedInitialSetup = true;
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
		this.updateContext(workspace);
		this.updateStatusBar(workspace);
	}

	private maybeNotify(workspace: Workspace) {
		this.maybeNotifyOutdated(workspace);
		this.maybeNotifyAutostop(workspace);
		if (this.completedInitialSetup) {
			// This instance might be created before the workspace is running
			this.maybeNotifyDeletion(workspace);
			this.maybeNotifyNotRunning(workspace);
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

	private isImpending(target: string, notifyTime: number): boolean {
		const nowTime = Date.now();
		const targetTime = new Date(target).getTime();
		const timeLeft = targetTime - nowTime;
		return timeLeft >= 0 && timeLeft <= notifyTime;
	}

	private maybeNotifyOutdated(workspace: Workspace) {
		if (!this.notifiedOutdated && workspace.outdated) {
			// Check if update notifications are disabled
			const disableNotifications = vscode.workspace
				.getConfiguration("coder")
				.get<boolean>("disableUpdateNotifications", false);
			if (disableNotifications) {
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
									workspace,
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
		if (workspace.outdated) {
			this.statusBarItem.show();
		} else {
			this.statusBarItem.hide();
		}
	}
}
