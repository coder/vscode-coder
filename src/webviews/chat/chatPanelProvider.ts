import { randomBytes } from "node:crypto";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";

import type * as vscode from "vscode";

/**
 * Provides a webview that embeds the Coder agent chat UI.
 * Authentication flows through postMessage:
 *
 *   1. The iframe loads /agents/{id}/embed on the Coder server.
 *   2. The embed page detects the user is signed out and sends
 *      { type: "coder:vscode-ready" } to window.parent.
 *   3. Our webview relays this to the extension host.
 *   4. The extension host replies with the session token.
 *   5. The webview forwards { type: "coder:vscode-auth-bootstrap" }
 *      with the token back into the iframe.
 *   6. The embed page calls API.setSessionToken(token), re-fetches
 *      the authenticated user, and renders the chat UI.
 */
export class ChatPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.chatPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private chatId: string | undefined;

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
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((msg: unknown) => {
				this.handleMessage(msg);
			}),
		);
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
		if (!coderUrl) {
			webview.html = this.getNoAgentHtml();
			return;
		}

		const embedUrl = `${coderUrl}/agents/${this.chatId}/embed`;
		webview.html = this.getIframeHtml(embedUrl, coderUrl);
	}

	private handleMessage(message: unknown): void {
		if (typeof message !== "object" || message === null) {
			return;
		}
		const msg = message as { type?: string };
		if (msg.type === "coder:vscode-ready") {
			const token = this.client.getSessionToken();
			if (!token) {
				this.logger.warn(
					"Chat iframe requested auth but no session token available",
				);
				return;
			}
			this.logger.info("Chat: forwarding token to iframe");
			this.view?.webview.postMessage({
				type: "coder:auth-bootstrap-token",
				token,
			});
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
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('chat-frame');
      const status = document.getElementById('status');

      iframe.addEventListener('load', () => {
        iframe.style.display = 'block';
        status.style.display = 'none';
      });

      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (event.source === iframe.contentWindow) {
          if (data.type === 'coder:vscode-ready') {
            status.textContent = 'Authenticating…';
            vscode.postMessage({ type: 'coder:vscode-ready' });
          }
          return;
        }

        if (data.type === 'coder:auth-bootstrap-token') {
          status.textContent = 'Signing in…';
          iframe.contentWindow.postMessage({
            type: 'coder:vscode-auth-bootstrap',
            payload: { token: data.token },
	          }, '${allowedOrigin}');
        }
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

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}
}
