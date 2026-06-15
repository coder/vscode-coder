import * as vscode from "vscode";

import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
	onWhileVisible,
} from "./dispatch";
import { getWebviewHtml } from "./html";
import { openJsonBeside } from "./openJson";

import type { Logger } from "../logging/logger";

export interface ResultPanelHandlerContext {
	/** Push the payload to the webview. */
	sendData: () => void;
	/** Open the raw CLI JSON in an editor beside the panel. */
	openRawJson: () => Promise<void>;
}

export interface ResultPanelOptions {
	extensionUri: vscode.Uri;
	logger: Logger;
	/** Panel view type, e.g. `coder.speedtestPanel`. */
	viewType: string;
	/** Bundle name under `dist/webviews/`. */
	webviewName: string;
	title: string;
	/** Raw CLI output backing the open-JSON action. */
	rawJson: string;
	/** Human-readable feature name used in error messages, e.g. "speed test". */
	jsonErrorLabel: string;
	/** Push the payload notification to the webview. */
	notify: (webview: vscode.Webview) => void;
	/**
	 * Build the handler maps with `buildCommandHandlers` and
	 * `buildRequestHandlers` so the compile-time exhaustiveness check stays
	 * with the concrete API definition.
	 */
	buildHandlers: (ctx: ResultPanelHandlerContext) => {
		commands: Record<string, (params: unknown) => void | Promise<void>>;
		requests: Record<string, (params: unknown) => Promise<unknown>>;
	};
}

/**
 * Create a webview panel that renders a one-shot CLI result. Owns the panel
 * scaffolding shared by such panels: HTML/CSP generation, payload re-send on
 * visibility and theme changes, message dispatch, and disposal.
 */
export function showResultPanel(options: ResultPanelOptions): void {
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

	const sendData = () => options.notify(panel.webview);
	const openRawJson = () =>
		openJsonBeside(options.rawJson, options.jsonErrorLabel, logger);
	const { commands, requests } = options.buildHandlers({
		sendData,
		openRawJson,
	});

	// Webview JS is discarded when hidden (no retainContextWhenHidden), and
	// renderers may cache theme colors, so we re-send on visibility or theme
	// change to rehydrate and redraw.
	const disposables: vscode.Disposable[] = [
		onWhileVisible(panel, panel.onDidChangeViewState, sendData),
		onWhileVisible(panel, vscode.window.onDidChangeActiveColorTheme, sendData),
		panel.webview.onDidReceiveMessage((message: unknown) => {
			if (isIpcRequest(message)) {
				void dispatchRequest(message, requests, panel.webview, { logger });
			} else if (isIpcCommand(message)) {
				void dispatchCommand(message, commands, { logger });
			} else {
				logger.warn(
					`Ignoring unrecognized ${webviewName} webview message`,
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
