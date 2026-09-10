import * as vscode from "vscode";

import {
	buildCommandHandlers,
	WorkspacesApi,
	type OpenWorkspaceParams,
} from "@repo/shared";

import { extractAgents } from "../../api/api-helper";
import {
	dispatchWebviewMessage,
	notifyWebview,
	type WebviewHandlers,
} from "../dispatch";
import { getWebviewHtml } from "../html";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { Commands } from "../../commands";
import type { Logger } from "../../logging/logger";

import type { WorkspaceStore } from "./workspaceStore";

/** Methods whose failures warrant a dialog; others are logged only. */
const USER_ACTION_METHODS: ReadonlySet<string> = new Set([
	WorkspacesApi.openWorkspace.method,
	WorkspacesApi.viewInDashboard.method,
]);

/**
 * Renders the workspaces of the current deployment in a webview. All state
 * lives in the store: every change is pushed whole, and a webview that just
 * loaded asks for it with `ready`.
 */
export class WorkspacesPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.workspacesPanel";

	private readonly handlers: WebviewHandlers = {
		requests: {},
		commands: buildCommandHandlers(WorkspacesApi, {
			ready: () => {
				// A webview that just loaded has nothing expanded.
				void this.store.watchAgents([]);
				this.pushState();
			},
			refresh: () => this.store.refresh(),
			setFilter: (p) => this.store.setFilter(p.filter),
			watchAgents: (p) => this.store.watchAgents(p.agentIds),
			openWorkspace: (p) => this.openWorkspace(p),
			viewInDashboard: (p) =>
				this.commands.openWorkspaceInDashboard(
					this.requireWorkspace(p.workspaceId),
					p.page,
				),
		}),
	};

	private view: vscode.WebviewView | undefined;
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly store: WorkspaceStore,
		private readonly commands: Pick<
			Commands,
			"openWorkspaceFromSidebar" | "openWorkspaceInDashboard"
		>,
		private readonly logger: Logger,
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	): void {
		if (token.isCancellationRequested) {
			return;
		}
		// Drop the view being replaced first, so its disposal cannot reach this one.
		this.detachView();
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(
					this.extensionUri,
					"dist",
					"webviews",
					"workspaces",
				),
			],
		};

		this.disposables.push(
			this.store.onDidChange((state) => this.pushState(state)),
			webviewView.onDidChangeVisibility(() => this.syncVisibility()),
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				dispatchWebviewMessage(message, this.handlers, webviewView.webview, {
					logger: this.logger,
					userActions: USER_ACTION_METHODS,
				}).catch((err: unknown) => {
					this.logger.error("Unhandled error in message handler", err);
				});
			}),
			webviewView.onDidDispose(() => {
				this.detachView();
				this.syncVisibility();
			}),
		);

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			"workspaces",
			"Coder Workspaces",
		);

		this.syncVisibility();
	}

	dispose(): void {
		this.detachView();
		this.syncVisibility();
	}

	private syncVisibility(): void {
		void this.store.setVisible(this.view?.visible ?? false);
	}

	private pushState(state = this.store.state): void {
		notifyWebview(this.view?.webview, WorkspacesApi.stateChanged, state);
	}

	private async openWorkspace({
		workspaceId,
		agentId,
	}: OpenWorkspaceParams): Promise<void> {
		const workspace = this.requireWorkspace(workspaceId);
		const agent = extractAgents(workspace.latest_build.resources).find(
			(candidate) => candidate.id === agentId,
		);
		if (agentId && !agent) {
			throw new Error("Agent is no longer available");
		}
		await this.commands.openWorkspaceFromSidebar(workspace, agent);
	}

	private requireWorkspace(workspaceId: string): Workspace {
		const workspace = this.store.findWorkspace(workspaceId);
		if (!workspace) {
			throw new Error("Workspace is no longer available");
		}
		return workspace;
	}

	private detachView(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
		this.view = undefined;
	}
}
