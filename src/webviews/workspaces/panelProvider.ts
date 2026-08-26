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
	readonly client: CoderApi;
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

	private readonly extensionUri: vscode.Uri;
	private readonly client: CoderApi;
	private readonly logger: Logger;
	private readonly store: WorkspaceStore;
	private readonly openWorkspace: WorkspacesPanelOptions["openWorkspace"];

	private readonly requestHandlers = buildRequestHandlers(WorkspacesApi, {});
	private readonly commandHandlers = buildCommandHandlers(WorkspacesApi, {
		ready: () => this.push(this.store.state),
		refresh: () => this.store.refresh(),
		setFilter: (p) => this.store.setFilter(p.filter),
		watchAgents: (p) => this.store.setWatchedAgents(p.agentIds),
		openWorkspace: (p) => this.handleOpenWorkspace(p),
		viewInDashboard: (p) => this.handleViewInDashboard(p),
	});

	private view: vscode.WebviewView | undefined;
	private disposables: vscode.Disposable[] = [];

	constructor(options: WorkspacesPanelOptions) {
		this.extensionUri = options.extensionUri;
		this.client = options.client;
		this.logger = options.logger;
		this.store = options.store;
		this.openWorkspace = options.openWorkspace;
	}

	public refresh(): void {
		this.store.refresh().catch((err: unknown) => {
			this.logger.error("Failed to refresh workspaces", err);
		});
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	): void {
		if (token.isCancellationRequested) {
			return;
		}
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

		this.disposeView();

		this.disposables.push(
			this.store.onDidChange((update) => this.push(update)),
			// Only listing follows visibility; the view keeps its context.
			webviewView.onDidChangeVisibility(() =>
				this.store.setVisible(webviewView.visible),
			),
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				this.handleMessage(message).catch((err: unknown) => {
					this.logger.error("Unhandled error in message handler", err);
				});
			}),
		);

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			"workspaces",
			"Coder Workspaces",
		);

		webviewView.onDidDispose(() => this.disposeView());

		void this.store.setVisible(webviewView.visible);
	}

	dispose(): void {
		this.disposeView();
	}

	private async handleMessage(message: unknown): Promise<void> {
		const showErrorToUser = (method: string) => USER_ACTION_METHODS.has(method);
		if (isIpcRequest(message)) {
			await dispatchRequest(message, this.requestHandlers, this.view?.webview, {
				logger: this.logger,
				showErrorToUser,
			});
		} else if (isIpcCommand(message)) {
			await dispatchCommand(message, this.commandHandlers, {
				logger: this.logger,
				showErrorToUser,
			});
		} else {
			this.logger.warn("Unexpected webview message", message);
		}
	}

	private push(update: WorkspacesUpdate): void {
		const webview = this.view?.webview;
		if (webview) {
			notifyWebview(webview, WorkspacesApi.stateUpdated, update);
		}
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
		await this.openWorkspace(workspace, agent);
	}

	private async handleViewInDashboard({
		workspaceId,
		page,
	}: ViewInDashboardParams): Promise<void> {
		const workspace = this.requireWorkspace(workspaceId);
		const connectionUrl = this.client.getHost();
		if (!connectionUrl) {
			return;
		}
		await openInBrowser(
			connectionUrl,
			`/@${createWorkspaceIdentifier(workspace)}${DASHBOARD_PAGE_PATHS[page]}`,
		);
	}

	private requireWorkspace(workspaceId: string): Workspace {
		const workspace = this.store.findWorkspace(workspaceId);
		if (!workspace) {
			throw new Error("Workspace is no longer available");
		}
		return workspace;
	}

	private disposeView(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}
}
