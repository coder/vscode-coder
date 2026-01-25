import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

/**
 * Message type for webview communication.
 * Matches @coder/shared WebviewMessage for consistency.
 */
export interface WebviewMessage<T = unknown> {
	type: string;
	data?: T;
}

/**
 * Generate a cryptographically secure nonce for CSP
 */
export function getNonce(): string {
	return randomBytes(16).toString("base64");
}

/**
 * Get the HTML content for a webview
 */
export function getWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	webviewName: string,
): string {
	const nonce = getNonce();

	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(
			extensionUri,
			"dist",
			"webviews",
			webviewName,
			"index.js",
		),
	);

	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(
			extensionUri,
			"dist",
			"webviews",
			webviewName,
			"index.css",
		),
	);

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
