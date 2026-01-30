import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

/**
 * Get the HTML content for a webview.
 */
export function getWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	webviewName: string,
	title: string,
): string {
	const nonce = getNonce();
	const baseUri = vscode.Uri.joinPath(
		extensionUri,
		"dist",
		"webviews",
		webviewName,
	);
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(baseUri, "index.js"),
	);
	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(baseUri, "index.css"),
	);

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

function getNonce(): string {
	return randomBytes(16).toString("base64");
}
