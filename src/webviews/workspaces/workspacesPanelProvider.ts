import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	WorkspacesApi,
} from "@repo/shared";

import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
} from "../dispatch";
import { getWebviewHtml } from "../html";

import type { Logger } from "../../logging/logger";

export class WorkspacesPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.workspacesPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	private readonly requestHandlers = buildRequestHandlers(WorkspacesApi, {});
	private readonly commandHandlers = buildCommandHandlers(WorkspacesApi, {});

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	public refresh(): void {
		this.logger.debug("Workspaces panel refresh requested");
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
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
	}

	private async handleMessage(message: unknown): Promise<void> {
		if (isIpcRequest(message)) {
			await dispatchRequest(message, this.requestHandlers, this.view?.webview, {
				logger: this.logger,
			});
		} else if (isIpcCommand(message)) {
			await dispatchCommand(message, this.commandHandlers, {
				logger: this.logger,
			});
		} else {
			this.logger.warn("Unexpected webview message", message);
		}
	}

	private disposeView(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}

	dispose(): void {
		this.disposeView();
	}
}
