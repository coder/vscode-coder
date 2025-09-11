import {
	Workspace,
	GetInboxNotificationResponse,
} from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";
import { type Storage } from "./storage";
import { OneWayCodeWebSocket } from "./websocket/oneWayCodeWebSocket";
import { CoderWebSocketClient } from "./websocket/webSocketClient";

// These are the template IDs of our notifications.
// Maybe in the future we should avoid hardcoding
// these in both coderd and here.
const TEMPLATE_WORKSPACE_OUT_OF_MEMORY = "a9d027b4-ac49-4fb1-9f6d-45af15f64e7a";
const TEMPLATE_WORKSPACE_OUT_OF_DISK = "f047f6a3-5713-40f7-85aa-0394cce9fa3a";

export class Inbox implements vscode.Disposable {
	readonly #storage: Storage;
	#disposed = false;
	#socket: OneWayCodeWebSocket<GetInboxNotificationResponse>;

	constructor(
		workspace: Workspace,
		webSocketClient: CoderWebSocketClient,
		storage: Storage,
	) {
		this.#storage = storage;

		const watchTemplates = [
			TEMPLATE_WORKSPACE_OUT_OF_DISK,
			TEMPLATE_WORKSPACE_OUT_OF_MEMORY,
		];

		const watchTargets = [workspace.id];

		this.#socket = webSocketClient.watchInboxNotifications(
			watchTemplates,
			watchTargets,
		);

		this.#socket.addEventListener("open", () => {
			this.#storage.output.info("Listening to Coder Inbox");
		});

		this.#socket.addEventListener("error", () => {
			// Errors are already logged internally
			this.dispose();
		});

		this.#socket.addEventListener("message", (data) => {
			if (data.parseError) {
				this.#storage.output.error(
					"Failed to parse inbox message",
					data.parseError,
				);
			} else {
				vscode.window.showInformationMessage(
					data.parsedMessage.notification.title,
				);
			}
		});
	}

	dispose() {
		if (!this.#disposed) {
			this.#storage.output.info("No longer listening to Coder Inbox");
			this.#socket.close();
			this.#disposed = true;
		}
	}
}
