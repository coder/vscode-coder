import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

/** Asset URIs for a webview's bundle. Use directly for custom HTML/CSP; otherwise call `getWebviewHtml`. */
export function getWebviewAssetUris(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	webviewName: string,
): { scriptUri: vscode.Uri; styleUri: vscode.Uri } {
	const baseUri = vscode.Uri.joinPath(
		extensionUri,
		"dist",
		"webviews",
		webviewName,
	);
	return {
		scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(baseUri, "index.js")),
		styleUri: webview.asWebviewUri(vscode.Uri.joinPath(baseUri, "index.css")),
	};
}

/** Build the webview CSP. Pass `frameSrc` to allow embedding an iframe. */
export function buildWebviewCsp(
	webview: vscode.Webview,
	nonce: string,
	options?: { frameSrc?: string },
): string {
	const directives = [
		"default-src 'none'",
		options?.frameSrc && `frame-src ${options.frameSrc}`,
		`script-src 'nonce-${nonce}'`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} data:`,
	];
	return directives.filter(Boolean).join("; ");
}

/** Standard webview HTML: mounts the package's bundle into `#root`. */
export function getWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	webviewName: string,
	title: string,
): string {
	const nonce = getNonce();
	const { scriptUri, styleUri } = getWebviewAssetUris(
		webview,
		extensionUri,
		webviewName,
	);

	// The vscode-elements library looks for a link element with "vscode-codicon-stylesheet"
	// ID to load the codicons font inside its shadow DOM components
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${buildWebviewCsp(webview, nonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link id="vscode-codicon-stylesheet" rel="stylesheet" href="${styleUri.toString()}" nonce="${nonce}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

export function getNonce(): string {
	return randomBytes(16).toString("base64");
}

/**
 * Escape characters with special meaning in HTML so user-controlled strings
 * can be safely interpolated into markup.
 */
export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

const HTML_ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
