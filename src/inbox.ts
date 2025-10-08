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
	private socket: OneWayWebSocket<GetInboxNotificationResponse> | undefined;
	private disposed = false;

	private constructor(private readonly logger: Logger) {}

	/**
	 * Factory method to create and initialize an Inbox.
	 * Use this instead of the constructor to properly handle async websocket initialization.
	 */
	static async create(
		workspace: Workspace,
		client: CoderApi,
		logger: Logger,
	): Promise<Inbox> {
		const inbox = new Inbox(logger);

		const watchTemplates = [
			TEMPLATE_WORKSPACE_OUT_OF_DISK,
			TEMPLATE_WORKSPACE_OUT_OF_MEMORY,
		];

		const watchTargets = [workspace.id];

		const socket = await client.watchInboxNotifications(
			watchTemplates,
			watchTargets,
		);

		socket.addEventListener("open", () => {
			logger.info("Listening to Coder Inbox");
		});

		socket.addEventListener("error", () => {
			// Errors are already logged internally
			inbox.dispose();
		});

		socket.addEventListener("message", (data) => {
			if (data.parseError) {
				logger.error("Failed to parse inbox message", data.parseError);
			} else {
				vscode.window.showInformationMessage(
					data.parsedMessage.notification.title,
				);
			}
		});

		inbox.socket = socket;

		return inbox;
	}

	dispose() {
		if (!this.disposed) {
			this.logger.info("No longer listening to Coder Inbox");
			this.socket?.close();
			this.disposed = true;
		}
	}
}
