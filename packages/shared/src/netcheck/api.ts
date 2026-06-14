import { defineCommand, defineNotification } from "../ipc/protocol";

import type { NetcheckData } from "./types";

export const NetcheckApi = {
	/** Extension pushes the parsed report to the webview */
	data: defineNotification<NetcheckData>("netcheck/data"),
	/** Webview signals that its message subscription is active */
	ready: defineCommand<void>("netcheck/ready"),
	/** Webview requests to open raw JSON in a text editor */
	viewJson: defineCommand<void>("netcheck/viewJson"),
} as const;
