import * as vscode from "vscode";

import { buildCommandHandlers, SpeedtestApi } from "@repo/shared";

import { getWebviewHtml } from "../util";

/**
 * Opens a webview panel to visualize speedtest results as a chart.
 */
export function showSpeedtestChart(
	extensionUri: vscode.Uri,
	json: string,
): void {
	const panel = vscode.window.createWebviewPanel(
		"coderSpeedtest",
		"Speed Test Results",
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(extensionUri, "dist", "webviews", "speedtest"),
			],
		},
	);

	panel.iconPath = {
		light: vscode.Uri.joinPath(extensionUri, "media", "logo-black.svg"),
		dark: vscode.Uri.joinPath(extensionUri, "media", "logo-white.svg"),
	};

	panel.webview.html = getWebviewHtml(
		panel.webview,
		extensionUri,
		"speedtest",
		"Speed Test Results",
	);

	const sendData = () => {
		panel.webview.postMessage({
			type: SpeedtestApi.data.method,
			data: json,
		});
	};

	// Send data now, and re-send whenever the panel becomes visible again
	sendData();
	panel.onDidChangeViewState(() => {
		if (panel.visible) {
			sendData();
		}
	});

	const commandHandlers = buildCommandHandlers(SpeedtestApi, {
		async viewJson(data: string) {
			const doc = await vscode.workspace.openTextDocument({
				content: data,
				language: "json",
			});
			await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
		},
	});

	panel.webview.onDidReceiveMessage(
		async (message: { method: string; params?: unknown }) => {
			const handler = commandHandlers[message.method];
			if (handler) {
				await handler(message.params);
			}
		},
	);
}
