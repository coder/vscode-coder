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
	workspaceName: string;
}

/** Creates webview panels that render speedtest runs as interactive charts. */
export class SpeedtestPanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	public show({ result, rawJson, workspaceName }: SpeedtestChartPayload): void {
		const title = `Speed Test: ${workspaceName}`;
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
		const payload: SpeedtestData = { workspaceName, result };
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
		sendData();

		const commandHandlers = buildCommandHandlers(SpeedtestApi, {
			async viewJson() {
				const doc = await vscode.workspace.openTextDocument({
					content: rawJson,
					language: "json",
				});
				await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
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
								"Unhandled error in speedtest message handler",
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
