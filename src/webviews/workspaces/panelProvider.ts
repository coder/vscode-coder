import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	WorkspacesApi,
	type DashboardPage,
	type OpenWorkspaceParams,
	type ViewInDashboardParams,
	type WorkspacesUpdate,
} from "@repo/shared";

import { createWorkspaceIdentifier, extractAgents } from "../../api/api-helper";
import { openInBrowser } from "../../util/uri";
import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
	notifyWebview,
	onWhileVisible,
} from "../dispatch";
import { getWebviewHtml } from "../html";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "../../api/coderApi";
import type { Logger } from "../../logging/logger";

import type { WorkspaceStore } from "./store";

/** Methods whose failures warrant a dialog; others are logged only. */
const USER_ACTION_METHODS: ReadonlySet<string> = new Set([
	WorkspacesApi.openWorkspace.method,
	WorkspacesApi.viewInDashboard.method,
]);

/** Path of each dashboard page, relative to the workspace. */
const DASHBOARD_PAGE_PATHS = {
	workspace: "",
	settings: "/settings",
} as const satisfies Record<DashboardPage, string>;

export interface WorkspacesPanelOptions {
	readonly extensionUri: vscode.Uri;
	readonly client: Pick<CoderApi, "getHost">;
	readonly logger: Logger;
	readonly store: WorkspaceStore;
	/** Connect to the workspace, or to one of its agents. */
	readonly openWorkspace: (
		workspace: Workspace,
		agent: WorkspaceAgent | undefined,
	) => Promise<unknown>;
}

/**
 * Renders the workspaces of the current deployment in a webview. All state
 * lives in the extension: the store reports what changed, this pushes it, and a
 * webview that just loaded asks for the whole state with `ready`.
 */
export class WorkspacesPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.workspacesPanel";

	private readonly requestHandlers = buildRequestHandlers(WorkspacesApi, {});
	private readonly commandHandlers = buildCommandHandlers(WorkspacesApi, {
		ready: () => this.push(this.options.store.state),
		refresh: () => this.options.store.refresh(),
		setFilter: (p) => this.options.store.setFilter(p.filter),
		watchAgents: (p) => this.options.store.setWatchedAgents(p.agentIds),
		openWorkspace: (p) => this.handleOpenWorkspace(p),
		viewInDashboard: (p) => this.handleViewInDashboard(p),
	});

	private view: vscode.WebviewView | undefined;
	private disposables: vscode.Disposable[] = [];

	constructor(private readonly options: WorkspacesPanelOptions) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	): void {
		if (token.isCancellationRequested) {
			return;
		}
		const { extensionUri, store } = this.options;

		// Drop the view being replaced first, so its disposal cannot reach this one.
		this.detachView();
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(extensionUri, "dist", "webviews", "workspaces"),
			],
		};

		this.disposables.push(
			store.onDidChange((update) => this.push(update)),
			// Listing and metadata both follow visibility; the view keeps its context.
			webviewView.onDidChangeVisibility(() => this.handleVisibility()),
			// CSS variables carry a theme change into the DOM on their own, but
			// anything rendered from a theme value at paint time keeps the old one.
			// Replaying the whole state lets the webview render it again. Nothing
			// is fetched: the store already has everything this needs.
			onWhileVisible(
				webviewView,
				vscode.window.onDidChangeActiveColorTheme,
				() => this.push(store.state),
			),
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				this.handleMessage(message).catch((err: unknown) => {
					this.options.logger.error("Unhandled error in message handler", err);
				});
			}),
			webviewView.onDidDispose(() => this.detachView()),
		);

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			extensionUri,
			"workspaces",
			"Coder Workspaces",
		);

		void store.setVisible(webviewView.visible);
	}

	dispose(): void {
		this.detachView();
	}

	/**
	 * Replay what the store has before it fetches, so a webview rebuilt while
	 * hidden renders the last known state right away.
	 */
	private handleVisibility(): void {
		const visible = this.view?.visible ?? false;
		if (visible) {
			this.push(this.options.store.state);
		}
		void this.options.store.setVisible(visible);
	}

	private async handleMessage(message: unknown): Promise<void> {
		const { logger } = this.options;
		const showErrorToUser = (method: string) => USER_ACTION_METHODS.has(method);
		if (isIpcRequest(message)) {
			await dispatchRequest(message, this.requestHandlers, this.view?.webview, {
				logger,
				showErrorToUser,
			});
		} else if (isIpcCommand(message)) {
			await dispatchCommand(message, this.commandHandlers, {
				logger,
				showErrorToUser,
			});
		} else {
			logger.warn("Unexpected webview message", message);
		}
	}

	private push(update: WorkspacesUpdate): void {
		notifyWebview(this.view?.webview, WorkspacesApi.stateUpdated, update);
	}

	private async handleOpenWorkspace({
		workspaceId,
		agentId,
	}: OpenWorkspaceParams): Promise<void> {
		const workspace = this.requireWorkspace(workspaceId);
		const agent = agentId
			? extractAgents(workspace.latest_build.resources).find(
					(candidate) => candidate.id === agentId,
				)
			: undefined;
		if (agentId && !agent) {
			throw new Error("Agent is no longer available");
		}
		await this.options.openWorkspace(workspace, agent);
	}

	private async handleViewInDashboard({
		workspaceId,
		page,
	}: ViewInDashboardParams): Promise<void> {
		const workspace = this.requireWorkspace(workspaceId);
		const connectionUrl = this.options.client.getHost();
		if (!connectionUrl) {
			return;
		}
		await openInBrowser(
			connectionUrl,
			`/@${createWorkspaceIdentifier(workspace)}${DASHBOARD_PAGE_PATHS[page]}`,
		);
	}

	private requireWorkspace(workspaceId: string): Workspace {
		const workspace = this.options.store.findWorkspace(workspaceId);
		if (!workspace) {
			throw new Error("Workspace is no longer available");
		}
		return workspace;
	}

	/** Let go of the current view: nothing is rendered until one resolves. */
	private detachView(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
		if (this.view) {
			this.view = undefined;
			void this.options.store.setVisible(false);
		}
	}
}
