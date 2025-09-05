import { Api } from "coder/site/src/api/api";
import {
	Workspace,
	GetInboxNotificationResponse,
} from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import * as vscode from "vscode";
import { errToStr } from "./api-helper";
import { type Storage } from "./storage";
import { OneWayCodeWebSocket } from "./websocket/OneWayCodeWebSocket";
import { watchInboxNotifications } from "./websocket/ws-helper";

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
		httpAgent: ProxyAgent,
		restClient: Api,
		storage: Storage,
	) {
		this.#storage = storage;

		const watchTemplates = [
			TEMPLATE_WORKSPACE_OUT_OF_DISK,
			TEMPLATE_WORKSPACE_OUT_OF_MEMORY,
		];

		const watchTargets = [workspace.id];

		this.#socket = watchInboxNotifications(
			restClient,
			httpAgent,
			watchTemplates,
			watchTargets,
		);

		this.#socket.addEventListener("open", () => {
			this.#storage.output.info("Listening to Coder Inbox");
		});

		this.#socket.addEventListener("error", (error) => {
			this.notifyError(error);
			this.dispose();
		});

		this.#socket.addEventListener("message", (data) => {
			try {
				const inboxMessage = data.parsedMessage!;
				vscode.window.showInformationMessage(inboxMessage.notification.title);
			} catch (error) {
				this.notifyError(error);
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

	private notifyError(error: unknown) {
		const message = errToStr(
			error,
			"Got empty error while monitoring Coder Inbox",
		);
		this.#storage.output.error(message);
	}
}
