import * as vscode from "vscode";

import { getWebviewHtml } from "../util";

import type { WebviewMessage } from "@repo/webview-shared";

export class TasksPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = "coder.tasksPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

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

		// Set up message handling before loading HTML to avoid race conditions
		this.disposables.forEach((d) => {
			d.dispose();
		});
		this.disposables = [];
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
				this.handleMessage(message);
			}),
		);

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			"tasks",
			"Coder Tasks",
		);

		webviewView.onDidDispose(() => {
			this.disposables.forEach((d) => {
				d.dispose();
			});
			this.disposables = [];
		});
	}

	private handleMessage(message: WebviewMessage): void {
		switch (message.type) {
			case "ready":
				this.sendMessage({ type: "init" });
				break;
			case "refresh":
				// Handle refresh
				break;
		}
	}

	private sendMessage(message: WebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}
}
