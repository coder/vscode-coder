import * as vscode from "vscode";

import type {
	Workspace,
	GetInboxNotificationResponse,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "./api/coderApi";
import type { Logger } from "./logging/logger";
import type { OneWayWebSocket } from "./websocket/oneWayWebSocket";

// These are the template IDs of our notifications.
// Maybe in the future we should avoid hardcoding
// these in both coderd and here.
const TEMPLATE_WORKSPACE_OUT_OF_MEMORY = "a9d027b4-ac49-4fb1-9f6d-45af15f64e7a";
const TEMPLATE_WORKSPACE_OUT_OF_DISK = "f047f6a3-5713-40f7-85aa-0394cce9fa3a";

export class Inbox implements vscode.Disposable {
	readonly #logger: Logger;
	#disposed = false;
	#socket: OneWayWebSocket<GetInboxNotificationResponse>;

	constructor(workspace: Workspace, client: CoderApi, logger: Logger) {
		this.#logger = logger;

		const watchTemplates = [
			TEMPLATE_WORKSPACE_OUT_OF_DISK,
			TEMPLATE_WORKSPACE_OUT_OF_MEMORY,
		];

		const watchTargets = [workspace.id];

		this.#socket = client.watchInboxNotifications(watchTemplates, watchTargets);

		this.#socket.addEventListener("open", () => {
			this.#logger.info("Listening to Coder Inbox");
		});

		this.#socket.addEventListener("error", () => {
			// Errors are already logged internally
			this.dispose();
		});

		this.#socket.addEventListener("message", (data) => {
			if (data.parseError) {
				this.#logger.error("Failed to parse inbox message", data.parseError);
			} else {
				vscode.window.showInformationMessage(
					data.parsedMessage.notification.title,
				);
			}
		});
	}

	dispose() {
		if (!this.#disposed) {
			this.#logger.info("No longer listening to Coder Inbox");
			this.#socket.close();
			this.#disposed = true;
		}
	}
}
