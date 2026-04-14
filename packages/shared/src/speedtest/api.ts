import { defineCommand, defineNotification } from "../ipc/protocol";

/**
 * Speedtest webview IPC API.
 */
export const SpeedtestApi = {
	/** Extension pushes JSON results to the webview */
	data: defineNotification<string>("speedtest/data"),
	/** Webview requests to open raw JSON in a text editor */
	viewJson: defineCommand<string>("speedtest/viewJson"),
} as const;
