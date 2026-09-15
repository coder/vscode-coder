import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	WorkspaceUpdateApi,
} from "@repo/shared";

import { DynamicUpdateSession } from "../../api/dynamicUpdateSession";
import {
	dispatchWebviewMessage,
	onWhileVisible,
	notifyWebview,
} from "../dispatch";
import { getWebviewHtml } from "../html";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "../../api/coderApi";
import type { Logger } from "../../logging/logger";

interface UpdatePanel {
	readonly panel: vscode.WebviewPanel;
	readonly result: Promise<boolean>;
}

/** Owns in-memory update forms; closing a form cancels any unsubmitted update. */
export class WorkspaceUpdatePanelFactory implements vscode.Disposable {
	private readonly panels = new Map<CoderApi, Map<string, UpdatePanel>>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	show(client: CoderApi, workspace: Workspace): Promise<boolean> {
		let clientPanels = this.panels.get(client);
		if (!clientPanels) {
			clientPanels = new Map();
			this.panels.set(client, clientPanels);
		}
		const existing = clientPanels.get(workspace.id);
		if (existing) {
			existing.panel.reveal();
			return existing.result;
		}

		const panel = vscode.window.createWebviewPanel(
			"coder.workspaceUpdate",
			`Update: ${workspace.owner_name}/${workspace.name}`,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(
						this.extensionUri,
						"dist",
						"webviews",
						"workspace-update",
					),
				],
			},
		);
		let finish!: (success: boolean) => void;
		let closed = false;
		const readyTimeout = setTimeout(() => {
			vscode.window.showErrorMessage(
				"The workspace update editor could not load. Please try again.",
			);
			panel.dispose();
		}, 30_000);
		const result = new Promise<boolean>((resolve) => {
			finish = resolve;
		});
		const session = new DynamicUpdateSession(client, workspace, (state) => {
			notifyWebview(panel.webview, WorkspaceUpdateApi.stateChanged, state);
		});
		const sendState = () =>
			notifyWebview(
				panel.webview,
				WorkspaceUpdateApi.stateChanged,
				session.state,
			);
		const commands = buildCommandHandlers(WorkspaceUpdateApi, {
			ready: () => {
				clearTimeout(readyTimeout);
				sendState();
			},
			change: ({ name, value }) => {
				if (typeof name === "string" && typeof value === "string")
					session.change(name, value);
			},
			retry: () => session.retry(),
			submit: async ({ revision }) => {
				if (!Number.isSafeInteger(revision)) return;
				if ((await session.submit(revision)) && !closed) {
					finish(true);
					panel.dispose();
				}
			},
			cancel: () => {
				panel.dispose();
			},
		});
		const requests = buildRequestHandlers(WorkspaceUpdateApi, {});
		const subscriptions = [
			onWhileVisible(panel, panel.onDidChangeViewState, sendState),
			onWhileVisible(
				panel,
				vscode.window.onDidChangeActiveColorTheme,
				sendState,
			),
			panel.webview.onDidReceiveMessage((message: unknown) => {
				if (!isUpdateMessage(message)) return;
				void dispatchWebviewMessage(
					message,
					{ commands, requests },
					panel.webview,
					{ logger: this.logger },
				);
			}),
		];
		clientPanels.set(workspace.id, { panel, result });
		panel.onDidDispose(() => {
			closed = true;
			clearTimeout(readyTimeout);
			session.dispose();
			for (const subscription of subscriptions) subscription.dispose();
			clientPanels.delete(workspace.id);
			if (clientPanels.size === 0) this.panels.delete(client);
			finish(false);
		});
		panel.webview.html = getWebviewHtml(
			panel.webview,
			this.extensionUri,
			"workspace-update",
			"Update Workspace",
		);
		void session.initialize();
		return result;
	}

	dispose(): void {
		for (const panels of this.panels.values()) {
			for (const { panel } of panels.values()) panel.dispose();
		}
		this.panels.clear();
	}
}

function isUpdateMessage(message: unknown): boolean {
	if (!message || typeof message !== "object" || !("method" in message))
		return false;
	if (message.method === WorkspaceUpdateApi.change.method) {
		return (
			"params" in message &&
			!!message.params &&
			typeof message.params === "object" &&
			"name" in message.params &&
			typeof message.params.name === "string" &&
			"value" in message.params &&
			typeof message.params.value === "string"
		);
	}
	if (message.method === WorkspaceUpdateApi.submit.method) {
		return (
			"params" in message &&
			!!message.params &&
			typeof message.params === "object" &&
			"revision" in message.params &&
			Number.isSafeInteger(message.params.revision)
		);
	}
	return [
		WorkspaceUpdateApi.ready.method,
		WorkspaceUpdateApi.retry.method,
		WorkspaceUpdateApi.cancel.method,
	].some((method) => method === message.method);
}
