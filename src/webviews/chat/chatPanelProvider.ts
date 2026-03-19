import { randomBytes } from "node:crypto";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";

import { ChatProxy } from "./chatProxy";

import type * as vscode from "vscode";

/**
 * Provides a webview that embeds the Coder agent chat UI.
 *
 * Authentication uses a local reverse proxy that injects the
 * session token header into every HTTP and WebSocket request.
 * The iframe loads from the proxy (http://127.0.0.1:PORT/SECRET/...)
 * so the Coder frontend works exactly as in a normal browser.
 */
export class ChatPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.chatPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private chatId: string | undefined;
	private proxy: ChatProxy | undefined;

	constructor(
		private readonly client: CoderApi,
		private readonly logger: Logger,
	) {}

	/**
	 * Opens the chat panel for the given chat ID.
	 * Called after a deep link reload via the persisted
	 * pendingChatId, or directly for testing.
	 */
	public openChat(chatId: string): void {
		this.chatId = chatId;
		this.refresh();
		this.view?.show(true);
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		this.renderView();
		webviewView.onDidDispose(() => this.dispose());
	}

	public refresh(): void {
		if (!this.view) {
			return;
		}
		this.renderView();
	}

	private renderView(): void {
		if (!this.view) {
			throw new Error("renderView called before resolveWebviewView");
		}
		const webview = this.view.webview;

		if (!this.chatId) {
			webview.html = this.getNoAgentHtml();
			return;
		}

		const coderUrl = this.client.getHost();
		const token = this.client.getSessionToken();
		if (!coderUrl || !token) {
			webview.html = this.getNoAgentHtml();
			return;
		}

		// Start the proxy and render the iframe once it's ready.
		void this.startProxyAndRender(coderUrl, token, this.chatId);
	}

	private async startProxyAndRender(
		coderUrl: string,
		token: string,
		chatId: string,
	): Promise<void> {
		// Dispose any existing proxy before starting a new one.
		this.proxy?.dispose();

		try {
			this.proxy = new ChatProxy(coderUrl, token, this.logger);
			const proxyBaseUrl = await this.proxy.listen();

			if (!this.view) {
				this.proxy.dispose();
				return;
			}

			const embedUrl = `${proxyBaseUrl}/agents/${chatId}/embed`;
			this.view.webview.html = this.getIframeHtml(embedUrl, proxyBaseUrl);
		} catch (err) {
			this.logger.warn("Failed to start chat proxy", err);
			if (this.view) {
				this.view.webview.html = this.getErrorHtml(
					"Failed to start authentication proxy.",
				);
			}
		}
	}

	private getIframeHtml(embedUrl: string, allowedOrigin: string): string {
		const nonce = randomBytes(16).toString("base64");

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 frame-src ${allowedOrigin};
                 script-src 'nonce-${nonce}';
                 style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coder Chat</title>
  <style>
    html, body {
      margin: 0; padding: 0;
      width: 100%; height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    iframe { border: none; width: 100%; height: 100%; }
    #status {
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px; padding: 16px; text-align: center;
    }
  </style>
</head>
<body>
  <div id="status">Loading chat…</div>
  <iframe id="chat-frame" src="${embedUrl}" allow="clipboard-write"
          style="display:none;"></iframe>
  <script nonce="${nonce}">
    (function () {
      const iframe = document.getElementById('chat-frame');
      const status = document.getElementById('status');

      iframe.addEventListener('load', () => {
        iframe.style.display = 'block';
        status.style.display = 'none';
      });
    })();
  </script>
</body>
</html>`;
	}

	private getNoAgentHtml(): string {
		return /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body{display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;padding:16px;box-sizing:border-box;
font-family:var(--vscode-font-family);color:var(--vscode-foreground);
text-align:center;}</style></head>
<body><p>No active chat session. Open a chat from the Agents tab on your Coder deployment.</p></body></html>`;
	}

	private getErrorHtml(message: string): string {
		return /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body{display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;padding:16px;box-sizing:border-box;
font-family:var(--vscode-font-family);color:var(--vscode-errorForeground, #f44);
text-align:center;}</style></head>
<body><p>${message}</p></body></html>`;
	}

	dispose(): void {
		this.proxy?.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}
}
