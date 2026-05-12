import * as vscode from "vscode";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";
import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
} from "../dispatch";
import { getWebviewHtml } from "../html";

export class ExperimentalWorkspacesPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.experimental.workspacesPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	// Empty handlers for now - will be populated as we build out the API
	private readonly requestHandlers = {};
	private readonly commandHandlers = {};

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly client: CoderApi,
		private readonly logger: Logger,
	) {}

	public refresh(): void {
		// TODO: Implement refresh logic
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
				vscode.Uri.joinPath(this.extensionUri, "dist", "webviews"),
			],
		};

		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];

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

		webviewView.onDidDispose(() => {
			for (const d of this.disposables) {
				d.dispose();
			}
			this.disposables = [];
		});
	}

	private async handleMessage(message: unknown): Promise<void> {
		const showErrorToUser = () => false;
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
		}
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}
}
