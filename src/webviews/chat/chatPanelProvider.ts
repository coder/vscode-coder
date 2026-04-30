import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	ChatApi,
} from "@repo/shared";

import { type CoderApi } from "../../api/coderApi";
import { type Logger } from "../../logging/logger";
import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
	notifyWebview,
} from "../dispatch";
import {
	buildWebviewCsp,
	escapeHtml,
	getNonce,
	getWebviewAssetUris,
} from "../html";

/**
 * Webview that embeds the Coder agent chat UI inside an iframe. The
 * panel's HTML pre-renders the iframe with `src=embedUrl`; the
 * `@repo/chat` bundle attaches listeners and bridges the iframe's
 * foreign `{ type, payload }` protocol to `ChatApi`. Auth flow:
 *
 *   1. Iframe loads /agents/{id}/embed and posts `coder:vscode-ready`.
 *   2. Bundle forwards as `ChatApi.vscodeReady`.
 *   3. Extension responds with `ChatApi.authBootstrapToken`.
 *   4. Bundle forwards the token into the iframe.
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
		private readonly extensionUri: vscode.Uri,
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

	private sendTheme(): void {
		notifyWebview(this.view?.webview, ChatApi.setTheme, {
			theme: this.getTheme(),
		});
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
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "chat"),
			],
		};
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
		const coderUrl = this.client.getHost();
		if (!this.chatId || !coderUrl) {
			webview.html = this.getNoAgentHtml();
			return;
		}
		const embedUrl = `${coderUrl}/agents/${this.chatId}/embed?theme=${this.getTheme()}`;
		webview.html = this.getEmbedHtml(webview, embedUrl);
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
			notifyWebview(this.view?.webview, ChatApi.authError, {
				error: "No session token available. Please sign in and retry.",
			});
			return;
		}
		this.logger.info("Chat: forwarding token to iframe");
		notifyWebview(this.view?.webview, ChatApi.authBootstrapToken, { token });
	}

	/**
	 * Pre-renders the iframe and adds `frame-src` to the CSP. The bundle
	 * attaches listeners; it doesn't construct the iframe.
	 */
	private getEmbedHtml(webview: vscode.Webview, embedUrl: string): string {
		const nonce = getNonce();
		const frameSrc = new URL(embedUrl).origin;
		const { scriptUri, styleUri } = getWebviewAssetUris(
			webview,
			this.extensionUri,
			"chat",
		);
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${buildWebviewCsp(webview, nonce, { frameSrc })}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coder Chat</title>
  <link rel="stylesheet" href="${styleUri.toString()}" nonce="${nonce}">
</head>
<body>
  <div id="status">Loading chat…</div>
  <iframe id="chat-frame" src="${escapeHtml(embedUrl)}" allow="clipboard-write" style="display:none;"></iframe>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
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
