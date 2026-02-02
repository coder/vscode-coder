// Message passing types - simple generic interface
export interface WebviewMessage<T = unknown> {
	type: string;
	data?: T;
}

/** Messages sent from the extension to the Tasks webview */
export type TasksExtensionMessage =
	| { type: "init" }
	| { type: "error"; data: string };

/** Messages sent from the Tasks webview to the extension */
export type TasksWebviewMessage = { type: "ready" } | { type: "refresh" };
