import * as vscode from "vscode";

import {
	buildCommandHandlers,
	type SpeedtestData,
	SpeedtestApi,
	type SpeedtestResult,
} from "@repo/shared";

import { getWebviewHtml } from "../util";

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
			panel.webview.postMessage({
				type: SpeedtestApi.data.method,
				data: payload,
			});
		const sendIfVisible = () => {
			if (panel.visible) {
				sendData();
			}
		};

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

		const disposables: vscode.Disposable[] = [
			panel.onDidChangeViewState(sendIfVisible),
			vscode.window.onDidChangeActiveColorTheme(sendIfVisible),
			panel.webview.onDidReceiveMessage(
				(message: { method: string; params?: unknown }) => {
					const handler = commandHandlers[message.method];
					if (handler) {
						Promise.resolve(handler(message.params)).catch((err: unknown) => {
							this.logger.error(
								`Unhandled error in speedtest handler for '${message.method}'`,
								err,
							);
						});
					}
				},
			),
		];
		panel.onDidDispose(() => {
			for (const d of disposables) {
				d.dispose();
			}
		});
	}
}
