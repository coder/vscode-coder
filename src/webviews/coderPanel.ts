import * as vscode from "vscode";

import { dispatchWebviewMessage, type WebviewHandlers } from "./dispatch";
import { getWebviewHtml } from "./html";

import type { Logger } from "../logging/logger";

export interface CoderPanelOptions {
	extensionUri: vscode.Uri;
	logger: Logger;
	/** Panel view type, e.g. `coder.speedtestPanel`. */
	viewType: string;
	/** Bundle name under `dist/webviews/`. */
	webviewName: string;
	title: string;
	/**
	 * Build the handler maps with `buildCommandHandlers` and
	 * `buildRequestHandlers` so the compile-time exhaustiveness check stays
	 * with the concrete API definition.
	 */
	buildHandlers: (panel: vscode.WebviewPanel) => WebviewHandlers;
}

/**
 * Opens a Coder-branded webview panel for a bundled webview and dispatches
 * its messages until the panel is disposed.
 */
export function createCoderPanel(
	options: CoderPanelOptions,
): vscode.WebviewPanel {
	const { extensionUri, logger, webviewName, title } = options;
	const panel = vscode.window.createWebviewPanel(
		options.viewType,
		title,
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(extensionUri, "dist", "webviews", webviewName),
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
		webviewName,
		title,
	);

	const handlers = options.buildHandlers(panel);
	const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
		void dispatchWebviewMessage(message, handlers, panel.webview, { logger });
	});
	panel.onDidDispose(() => {
		listener.dispose();
	});
	return panel;
}
