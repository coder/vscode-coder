import * as vscode from "vscode";

import { getWebviewHtml, type WebviewMessage } from "../util";

export class TasksPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = "coder.tasksPanel";

	private view?: vscode.WebviewView;

	constructor(private readonly extensionUri: vscode.Uri) {}

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

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			"tasks",
		);

		this.setupMessageHandling(webviewView.webview);
	}

	private setupMessageHandling(webview: vscode.Webview): void {
		webview.onDidReceiveMessage((message: WebviewMessage) => {
			switch (message.type) {
				case "ready":
					this.sendMessage({ type: "init" });
					break;
				case "refresh":
					// Handle refresh
					break;
			}
		});
	}

	private sendMessage(message: WebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}
}
