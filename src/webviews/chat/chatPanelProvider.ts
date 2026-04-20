import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	ChatApi,
	type NotificationDef,
} from "@repo/shared";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";
import {
	dispatchCommand,
	dispatchRequest,
	getNonce,
	isIpcCommand,
	isIpcRequest,
	notifyWebview,
} from "../util";

/**
 * Provides a webview that embeds the Coder agent chat UI.
 * Authentication flows through postMessage:
 *
 *   1. The iframe loads /agents/{id}/embed on the Coder server.
 *   2. The embed page detects the user is signed out and posts
 *      { type: "coder:vscode-ready" } to window.parent.
 *   3. Our shim relays that to the extension as a ChatApi.vscodeReady
 *      command.
 *   4. The extension pushes the session token back with
 *      ChatApi.authBootstrapToken.
 *   5. The shim forwards it into the iframe, which calls
 *      API.setSessionToken and re-fetches the user.
 */
export class ChatPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.chatPanel";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private chatId: string | undefined;
	private authRetryTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly commandHandlers = buildCommandHandlers(ChatApi, {
		vscodeReady: () => this.sendAuthToken(),
		chatReady: () => this.sendTheme(),
		navigate: ({ url }) => this.handleNavigate(url),
	});
	private readonly requestHandlers = buildRequestHandlers(ChatApi, {});

	constructor(
		private readonly client: Pick<CoderApi, "getHost" | "getSessionToken">,
		private readonly logger: Logger,
	) {}

	private getTheme(): "light" | "dark" {
		const kind = vscode.window.activeColorTheme.kind;
		return kind === vscode.ColorThemeKind.Light ||
			kind === vscode.ColorThemeKind.HighContrastLight
			? "light"
			: "dark";
	}

	private notify<D>(
		def: NotificationDef<D>,
		...args: D extends void ? [] : [data: D]
	): void {
		if (this.view) {
			notifyWebview(this.view.webview, def, ...args);
		}
	}

	private sendTheme(): void {
		this.notify(ChatApi.setTheme, { theme: this.getTheme() });
	}

	/**
	 * Opens the chat panel for the given chat ID.
	 * Called after a deep link reload via the persisted
	 * pendingChatId, or directly for testing.
	 */
	public openChat(chatId: string): void {
		if (this.chatId === chatId && this.view) {
			this.view.show(true);
			return;
		}
		this.chatId = chatId;
		// No-op if unresolved; the focus command triggers resolveWebviewView().
		this.refresh();
		void vscode.commands.executeCommand(`${ChatPanelProvider.viewType}.focus`);
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		// Clean up state from a previous view instance to avoid
		// duplicates if VS Code re-resolves the view.
		this.disposeView();
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				if (isIpcRequest(message)) {
					void dispatchRequest(
						message,
						this.requestHandlers,
						webviewView.webview,
						{ logger: this.logger },
					);
				} else if (isIpcCommand(message)) {
					void dispatchCommand(message, this.commandHandlers, {
						logger: this.logger,
						showErrorToUser: () => false,
					});
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => {
				this.sendTheme();
			}),
		);
		this.renderView();
		this.disposables.push(webviewView.onDidDispose(() => this.disposeView()));
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

		const embedUrl = `${coderUrl}/agents/${this.chatId}/embed?theme=${this.getTheme()}`;
		webview.html = this.getIframeHtml(embedUrl, coderUrl);
	}

	private handleNavigate(url: string): void {
		const coderUrl = this.client.getHost();
		if (!url || !coderUrl) {
			return;
		}
		try {
			const resolved = new URL(url, coderUrl);
			const expected = new URL(coderUrl);
			if (resolved.origin === expected.origin) {
				void vscode.env.openExternal(vscode.Uri.parse(resolved.toString()));
			}
		} catch {
			this.logger.warn(`Chat: invalid navigate URL: ${url}`);
		}
	}

	/**
	 * Attempt to forward the session token to the chat iframe.
	 * The token may not be available immediately after a reload
	 * (e.g. deployment setup is still in progress), so we retry
	 * with exponential backoff before giving up.
	 */
	private static readonly MAX_AUTH_RETRIES = 5;
	private static readonly AUTH_RETRY_BASE_MS = 500;

	private sendAuthToken(attempt = 0): void {
		clearTimeout(this.authRetryTimer);
		const token = this.client.getSessionToken();
		if (!token) {
			if (attempt < ChatPanelProvider.MAX_AUTH_RETRIES) {
				const delay = ChatPanelProvider.AUTH_RETRY_BASE_MS * 2 ** attempt;
				this.logger.info(
					`Chat: no session token yet, retrying in ${delay}ms ` +
						`(attempt ${attempt + 1}/${ChatPanelProvider.MAX_AUTH_RETRIES})`,
				);
				this.authRetryTimer = setTimeout(
					() => this.sendAuthToken(attempt + 1),
					delay,
				);
				return;
			}
			this.logger.warn(
				"Chat iframe requested auth but no session token available " +
					"after all retries",
			);
			this.notify(ChatApi.authError, {
				error: "No session token available. Please sign in and retry.",
			});
			return;
		}
		this.logger.info("Chat: forwarding token to iframe");
		this.notify(ChatApi.authBootstrapToken, { token });
	}

	private getIframeHtml(embedUrl: string, allowedOrigin: string): string {
		const nonce = getNonce();

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
    #retry-btn {
      margin-top: 12px; padding: 6px 16px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    #retry-btn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
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

      // Shim sits between two wire formats. The iframe speaks
      // { type, payload } (a contract owned by the Coder server).
      // The extension speaks the IPC protocol: commands are
      // { method, params } and notifications are { type, data }.
      // See packages/webview-shared/README.md.
      const toIframe = (type, payload) => {
        iframe.contentWindow.postMessage({ type, payload }, '${allowedOrigin}');
      };

      const showRetry = (error) => {
        status.textContent = '';
        status.appendChild(document.createTextNode(error || 'Authentication failed.'));
        const btn = document.createElement('button');
        btn.id = 'retry-btn';
        btn.textContent = 'Retry';
        btn.addEventListener('click', () => {
          status.textContent = 'Authenticating…';
          vscode.postMessage({ method: 'coder:vscode-ready' });
        });
        status.appendChild(document.createElement('br'));
        status.appendChild(btn);
        status.style.display = 'block';
        iframe.style.display = 'none';
      };

      const handleFromIframe = (msg) => {
        switch (msg.type) {
          case 'coder:vscode-ready':
            status.textContent = 'Authenticating…';
            vscode.postMessage({ method: 'coder:vscode-ready' });
            return;
          case 'coder:chat-ready':
            vscode.postMessage({ method: 'coder:chat-ready' });
            return;
          case 'coder:navigate':
            vscode.postMessage({
              method: 'coder:navigate',
              params: { url: msg.payload?.url },
            });
            return;
        }
      };

      const handleFromExtension = (msg) => {
        const data = msg.data || {};
        switch (msg.type) {
          case 'coder:auth-bootstrap-token':
            status.textContent = 'Signing in…';
            toIframe('coder:vscode-auth-bootstrap', { token: data.token });
            return;
          case 'coder:set-theme':
            toIframe('coder:set-theme', { theme: data.theme });
            return;
          case 'coder:auth-error':
            showRetry(data.error);
            return;
        }
      };

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (event.source === iframe.contentWindow) {
          handleFromIframe(msg);
        } else {
          handleFromExtension(msg);
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

	private disposeView(): void {
		clearTimeout(this.authRetryTimer);
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}

	dispose(): void {
		this.disposeView();
	}
}
