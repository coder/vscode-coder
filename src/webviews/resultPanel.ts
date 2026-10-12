import * as vscode from "vscode";

import { createCoderPanel, type CoderPanelOptions } from "./coderPanel";
import { onWhileVisible, type WebviewHandlers } from "./dispatch";
import { openJsonBeside } from "./openJson";

export interface ResultPanelHandlerContext {
	/** Push the payload to the webview. */
	sendData: () => void;
	/** Open the raw CLI JSON in an editor beside the panel. */
	openRawJson: () => Promise<void>;
}

export interface ResultPanelOptions extends Omit<
	CoderPanelOptions,
	"buildHandlers"
> {
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
	buildHandlers: (ctx: ResultPanelHandlerContext) => WebviewHandlers;
}

/**
 * Create a webview panel that renders a one-shot CLI result, re-sending the
 * payload on visibility and theme changes.
 */
export function showResultPanel(options: ResultPanelOptions): void {
	// Called only after the panel exists.
	const sendData = () => options.notify(panel.webview);
	const openRawJson = () =>
		openJsonBeside(options.rawJson, options.jsonErrorLabel, options.logger);
	const panel = createCoderPanel({
		...options,
		buildHandlers: () => options.buildHandlers({ sendData, openRawJson }),
	});

	// Webview JS is discarded when hidden (no retainContextWhenHidden), and
	// renderers may cache theme colors, so we re-send on visibility or theme
	// change to rehydrate and redraw.
	const disposables: vscode.Disposable[] = [
		onWhileVisible(panel, panel.onDidChangeViewState, sendData),
		onWhileVisible(panel, vscode.window.onDidChangeActiveColorTheme, sendData),
	];
	panel.onDidDispose(() => {
		for (const d of disposables) {
			d.dispose();
		}
	});
}
