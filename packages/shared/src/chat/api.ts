import { defineCommand, defineNotification } from "../ipc/protocol";

/** Chat webview API. */
export const ChatApi = {
	/** Iframe reports it needs the session token. */
	vscodeReady: defineCommand("coder:vscode-ready"),
	/** Iframe reports the chat UI has rendered. */
	chatReady: defineCommand("coder:chat-ready"),
	/** Iframe requests an external navigation; same-origin only. */
	navigate: defineCommand<{ url: string }>("coder:navigate"),

	/** Push the current theme into the iframe. */
	setTheme: defineNotification<{ theme: "light" | "dark" }>("coder:set-theme"),
	/** Push the session token to bootstrap iframe auth. */
	authBootstrapToken: defineNotification<{ token: string }>(
		"coder:auth-bootstrap-token",
	),
	/** Signal that auth could not be obtained. */
	authError: defineNotification<{ error: string }>("coder:auth-error"),
} as const;
