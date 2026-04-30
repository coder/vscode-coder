import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	SpeedtestApi,
	type SpeedtestData,
	type SpeedtestResult,
} from "@repo/shared";

import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
	notifyWebview,
	onWhileVisible,
} from "../dispatch";
import { getWebviewHtml } from "../html";

import type { Logger } from "../../logging/logger";

export interface SpeedtestChartPayload {
	result: SpeedtestResult;
	rawJson: string;
	workspaceId: string;
}

/** Creates webview panels that render speedtest runs as interactive charts. */
export class SpeedtestPanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	public show({ result, rawJson, workspaceId }: SpeedtestChartPayload): void {
		const title = `Speed Test: ${workspaceId}`;
		const panel = vscode.window.createWebviewPanel(
			"coder.speedtestPanel",
			title,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(
						this.extensionUri,
						"dist",
						"webviews",
						"speedtest",
					),
				],
			},
		);

		panel.iconPath = {
			light: vscode.Uri.joinPath(this.extensionUri, "media", "logo-black.svg"),
			dark: vscode.Uri.joinPath(this.extensionUri, "media", "logo-white.svg"),
		};

		panel.webview.html = getWebviewHtml(
			panel.webview,
			this.extensionUri,
			"speedtest",
			title,
		);

		// Webview JS is discarded when hidden (no retainContextWhenHidden), and
		// the canvas caches theme colors into pixels, so we re-send on visibility
		// or theme change to rehydrate and redraw.
		const payload: SpeedtestData = { workspaceId, result };
		const sendData = () =>
			notifyWebview(panel.webview, SpeedtestApi.data, payload);

		// Both builders emit a compile error if any command or request in the
		// API lacks a handler here; the empty `{}` below is still load-bearing.
		const commandHandlers = buildCommandHandlers(SpeedtestApi, {
			// Webview signals it's subscribed; safe to push the payload now.
			ready: () => {
				sendData();
			},
			viewJson: async () => {
				try {
					const doc = await vscode.workspace.openTextDocument({
						content: rawJson,
						language: "json",
					});
					await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
				} catch (err) {
					this.logger.error("Failed to open speedtest JSON", err);
					vscode.window.showErrorMessage(
						"Failed to open speed test JSON. Check `Output > Coder` for details.",
					);
				}
			},
		});
		const requestHandlers = buildRequestHandlers(SpeedtestApi, {});

		const logger = this.logger;
		const disposables: vscode.Disposable[] = [
			onWhileVisible(panel, panel.onDidChangeViewState, sendData),
			onWhileVisible(
				panel,
				vscode.window.onDidChangeActiveColorTheme,
				sendData,
			),
			panel.webview.onDidReceiveMessage((message: unknown) => {
				if (isIpcRequest(message)) {
					void dispatchRequest(message, requestHandlers, panel.webview, {
						logger,
					});
				} else if (isIpcCommand(message)) {
					void dispatchCommand(message, commandHandlers, { logger });
				} else {
					logger.warn(
						"Ignoring unrecognized speedtest webview message",
						message,
					);
				}
			}),
		];
		panel.onDidDispose(() => {
			for (const d of disposables) {
				d.dispose();
			}
		});
	}
}
