import * as vscode from "vscode";

import {
	buildCommandHandlers,
	type SpeedtestData,
	SpeedtestApi,
} from "@repo/shared";

import { getWebviewHtml } from "../util";

export function showSpeedtestChart(
	extensionUri: vscode.Uri,
	json: string,
	workspaceName: string,
): void {
	const title = `Speed Test: ${workspaceName}`;
	const panel = vscode.window.createWebviewPanel(
		"coder.speedtestPanel",
		title,
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
		title,
	);

	// Webview context is discarded when hidden (no retainContextWhenHidden),
	// so re-send on visibility change to re-hydrate the chart. Also re-send on
	// theme change so the canvas (which caches theme colors into pixels) redraws.
	const payload: SpeedtestData = { json, workspaceName };
	const sendData = () => {
		panel.webview.postMessage({
			type: SpeedtestApi.data.method,
			data: payload,
		});
	};
	sendData();

	const disposables: vscode.Disposable[] = [
		panel.onDidChangeViewState(() => {
			if (panel.visible) {
				sendData();
			}
		}),
		vscode.window.onDidChangeActiveColorTheme(() => {
			if (panel.visible) {
				sendData();
			}
		}),
	];
	panel.onDidDispose(() => {
		for (const d of disposables) {
			d.dispose();
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
		(message: { method: string; params?: unknown }) => {
			const handler = commandHandlers[message.method];
			if (handler) {
				Promise.resolve(handler(message.params)).catch(() => undefined);
			}
		},
	);
}
