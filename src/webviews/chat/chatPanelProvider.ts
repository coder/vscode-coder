import * as http from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import * as vscode from "vscode";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";

/**
 * A local reverse proxy that forwards requests to the Coder server.
 * This exists solely to work around VS Code's webview sandbox which
 * blocks script execution in nested cross-origin iframes. By serving
 * through a local proxy the iframe gets its own browsing context and
 * scripts execute normally.
 *
 * The proxy does NOT inject auth headers — authentication is handled
 * entirely via the postMessage bootstrap flow.
 */
class EmbedProxy implements vscode.Disposable {
	private server?: http.Server;
	private _port = 0;

	constructor(
		private readonly coderUrl: string,
		private readonly logger: Logger,
	) {}

	get port(): number {
		return this._port;
	}

	async start(): Promise<number> {
		const target = new URL(this.coderUrl);

		this.server = http.createServer((req, res) => {
			const options: http.RequestOptions = {
				hostname: target.hostname,
				port: target.port || 80,
				path: req.url,
				method: req.method,
				headers: {
					...req.headers,
					host: target.host,
				},
			};

			const proxyReq = http.request(options, (proxyRes) => {
				res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
				proxyRes.pipe(res, { end: true });
			});

			proxyReq.on("error", (err) => {
				this.logger.warn("Embed proxy request error", err);
				res.writeHead(502);
				res.end("Bad Gateway");
			});

			req.pipe(proxyReq, { end: true });
		});

		return new Promise<number>((resolve, reject) => {
			this.server!.listen(0, "127.0.0.1", () => {
				const addr = this.server!.address();
				if (typeof addr === "object" && addr !== null) {
					this._port = addr.port;
					this.logger.info(
						`Embed proxy listening on 127.0.0.1:${this._port}`,
					);
					resolve(this._port);
				} else {
					reject(new Error("Failed to bind embed proxy"));
				}
			});
			this.server!.on("error", reject);
		});
	}

	dispose(): void {
		this.server?.close();
	}
}

/**
 * Provides a webview that embeds the Coder agent chat UI via a local
 * proxy. Authentication flows through postMessage:
 *
 *   1. The iframe loads /agents/{id}/embed through the proxy.
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
	private proxy?: EmbedProxy;
	private agentId: string | undefined;

	constructor(
		private readonly client: CoderApi,
		private readonly logger: Logger,
	) {}

	/**
	 * Called by the `/openChat` URI handler.
	 */
	public openChat(agentId: string): void {
		this.agentId = agentId;
		this.refresh();
		vscode.commands
			.executeCommand("workbench.action.focusAuxiliaryBar")
			.then(() =>
				vscode.commands.executeCommand("coder.chatPanel.focus"),
			);
	}

	async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): Promise<void> {
		this.view = webviewView;

		if (!this.agentId) {
			webviewView.webview.html = this.getNoAgentHtml();
			return;
		}

		const coderUrl = this.client.getHost();
		if (!coderUrl) {
			webviewView.webview.html = this.getNoAgentHtml();
			return;
		}

		webviewView.webview.options = { enableScripts: true };

		this.disposeInternals();

		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((msg: unknown) => {
				this.handleMessage(msg);
			}),
		);

		this.proxy = new EmbedProxy(coderUrl, this.logger);
		this.disposables.push(this.proxy);

		try {
			const port = await this.proxy.start();
			const proxyOrigin = `http://127.0.0.1:${port}`;
			const embedUrl = `${proxyOrigin}/agents/${this.agentId}/embed`;
			webviewView.webview.html = this.getIframeHtml(
				embedUrl,
				proxyOrigin,
			);
		} catch (err) {
			this.logger.error("Failed to start embed proxy", err);
			webviewView.webview.html = this.getErrorHtml(
				"Failed to start embed proxy.",
			);
		}

		webviewView.onDidDispose(() => this.disposeInternals());
	}

	public refresh(): void {
		if (!this.view) {
			return;
		}

		if (!this.agentId) {
			this.view.webview.html = this.getNoAgentHtml();
			return;
		}

		const coderUrl = this.client.getHost();
		if (!coderUrl) {
			this.view.webview.html = this.getNoAgentHtml();
			return;
		}

		this.disposeInternals();

		this.proxy = new EmbedProxy(coderUrl, this.logger);
		this.disposables.push(this.proxy);

		this.disposables.push(
			this.view.webview.onDidReceiveMessage((msg: unknown) => {
				this.handleMessage(msg);
			}),
		);

		this.proxy
			.start()
			.then((port) => {
				const proxyOrigin = `http://127.0.0.1:${port}`;
				const embedUrl = `${proxyOrigin}/agents/${this.agentId}/embed`;
				if (this.view) {
					this.view.webview.options = { enableScripts: true };
					this.view.webview.html = this.getIframeHtml(
						embedUrl,
						proxyOrigin,
					);
				}
			})
			.catch((err) => {
				this.logger.error("Failed to restart embed proxy", err);
				if (this.view) {
					this.view.webview.html = this.getErrorHtml(
						"Failed to start embed proxy.",
					);
				}
			});
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

	private getIframeHtml(embedUrl: string, proxyOrigin: string): string {
		const nonce = randomBytes(16).toString("base64");

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 frame-src ${proxyOrigin};
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

      function log(msg) { console.log('[CoderChat] ' + msg); }

      log('Webview loaded, iframe src: ' + iframe.src);

      iframe.addEventListener('load', () => {
        log('iframe load event');
        iframe.style.display = 'block';
        status.style.display = 'none';
      });

      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (event.source === iframe.contentWindow) {
          log('From iframe: ' + JSON.stringify(data.type));
          if (data.type === 'coder:vscode-ready') {
            log('Requesting token from extension host');
            status.textContent = 'Authenticating…';
            vscode.postMessage({ type: 'coder:vscode-ready' });
          }
          return;
        }

        if (data.type === 'coder:auth-bootstrap-token') {
          log('Forwarding token to iframe');
          status.textContent = 'Signing in…';
          iframe.contentWindow.postMessage({
            type: 'coder:vscode-auth-bootstrap',
            payload: { token: data.token },
          }, '*');
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

	private getErrorHtml(message: string): string {
		return /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body{display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;font-family:var(--vscode-font-family);
color:var(--vscode-errorForeground,#f44);}</style></head>
<body><p>${message}</p></body></html>`;
	}

	private disposeInternals(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
	}

	dispose(): void {
		this.disposeInternals();
	}
}
