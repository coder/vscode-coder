import { Api } from "coder/site/src/api/api";
import {
	Workspace,
	GetInboxNotificationResponse,
} from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import { coderSessionTokenHeader } from "./api";
import { errToStr } from "./api-helper";
import { type Storage } from "./storage";

// These are the template IDs of our notifications.
// Maybe in the future we should avoid hardcoding
// these in both coderd and here.
const TEMPLATE_WORKSPACE_OUT_OF_MEMORY = "a9d027b4-ac49-4fb1-9f6d-45af15f64e7a";
const TEMPLATE_WORKSPACE_OUT_OF_DISK = "f047f6a3-5713-40f7-85aa-0394cce9fa3a";

export class Inbox implements vscode.Disposable {
	readonly #storage: Storage;
	#disposed = false;
	#socket: WebSocket;

	constructor(
		workspace: Workspace,
		httpAgent: ProxyAgent,
		restClient: Api,
		storage: Storage,
	) {
		this.#storage = storage;

		const baseUrlRaw = restClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}

		const watchTemplates = [
			TEMPLATE_WORKSPACE_OUT_OF_DISK,
			TEMPLATE_WORKSPACE_OUT_OF_MEMORY,
		];
		const watchTemplatesParam = encodeURIComponent(watchTemplates.join(","));

		const watchTargets = [workspace.id];
		const watchTargetsParam = encodeURIComponent(watchTargets.join(","));

		// We shouldn't need to worry about this throwing. Whilst `baseURL` could
		// be an invalid URL, that would've caused issues before we got to here.
		const baseUrl = new URL(baseUrlRaw);
		const socketProto = baseUrl.protocol === "https:" ? "wss:" : "ws:";
		const socketUrl = `${socketProto}//${baseUrl.host}/api/v2/notifications/inbox/watch?format=plaintext&templates=${watchTemplatesParam}&targets=${watchTargetsParam}`;

		const token = restClient.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;
		this.#socket = new WebSocket(new URL(socketUrl), {
			agent: httpAgent,
			followRedirects: true,
			headers: token
				? {
						[coderSessionTokenHeader]: token,
					}
				: undefined,
		});

		this.#socket.on("open", () => {
			this.#storage.output.info("Listening to Coder Inbox");
		});

		this.#socket.on("error", (error) => {
			this.notifyError(error);
			this.dispose();
		});

		this.#socket.on("message", (data) => {
			try {
				const inboxMessage = JSON.parse(
					data.toString(),
				) as GetInboxNotificationResponse;

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
