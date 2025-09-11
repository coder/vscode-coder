import { Api } from "coder/site/src/api/api";
import {
	GetInboxNotificationResponse,
	ProvisionerJobLog,
	ServerSentEvent,
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { ClientOptions } from "ws";
import { coderSessionTokenHeader, createHttpAgent } from "../api";
import { WsLogger } from "../logging/netLog";
import { Storage } from "../storage";
import { OneWayCodeWebSocket } from "./oneWayCodeWebSocket";

/**
 * WebSocket client for Coder API connections.
 *
 * Automatically configures logging for WebSocket events:
 * - Connection attempts, successful opens and closes at the trace level
 * - Errors at the error level
 */
export class CoderWebSocketClient {
	constructor(
		private readonly client: Api,
		private readonly storage: Storage,
	) {}

	watchInboxNotifications = (
		watchTemplates: string[],
		watchTargets: string[],
		options?: ClientOptions,
	) => {
		return this.createWebSocket<GetInboxNotificationResponse>({
			apiRoute: "/api/v2/notifications/inbox/watch",
			searchParams: {
				format: "plaintext",
				templates: watchTemplates.join(","),
				targets: watchTargets.join(","),
			},
			options,
		});
	};

	watchWorkspace = (workspace: Workspace, options?: ClientOptions) => {
		return this.createWebSocket<ServerSentEvent>({
			apiRoute: `/api/v2/workspaces/${workspace.id}/watch-ws`,
			options,
		});
	};

	watchAgentMetadata = (
		agentId: WorkspaceAgent["id"],
		options?: ClientOptions,
	) => {
		return this.createWebSocket<ServerSentEvent>({
			apiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata-ws`,
			options,
		});
	};

	watchBuildLogsByBuildId = (buildId: string, logs: ProvisionerJobLog[]) => {
		const searchParams = new URLSearchParams({ follow: "true" });
		if (logs.length) {
			searchParams.append("after", logs[logs.length - 1].id.toString());
		}

		const socket = this.createWebSocket<ProvisionerJobLog>({
			apiRoute: `/api/v2/workspacebuilds/${buildId}/logs`,
			searchParams,
		});

		return socket;
	};

	private createWebSocket<TData = unknown>(configs: {
		apiRoute: string;
		protocols?: string | string[];
		searchParams?: Record<string, string> | URLSearchParams;
		options?: ClientOptions;
	}) {
		const baseUrlRaw = this.client.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}

		const baseUrl = new URL(baseUrlRaw);
		const token = this.client.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;

		const httpAgent = createHttpAgent();
		const webSocket = new OneWayCodeWebSocket<TData>({
			location: baseUrl,
			...configs,
			options: {
				agent: httpAgent,
				followRedirects: true,
				headers: {
					...(token ? { [coderSessionTokenHeader]: token } : {}),
					...configs.options?.headers,
				},
				...configs.options,
			},
		});

		const wsUrl = new URL(webSocket.url);
		const pathWithQuery = wsUrl.pathname + wsUrl.search;
		const wsLogger = new WsLogger(this.storage.output, pathWithQuery);
		wsLogger.logConnecting();

		webSocket.addEventListener("open", () => {
			wsLogger.logOpen();
		});

		webSocket.addEventListener("message", (event) => {
			wsLogger.logMessage(event.sourceEvent.data);
		});

		webSocket.addEventListener("close", (event) => {
			wsLogger.logClose(event.code, event.reason);
		});

		webSocket.addEventListener("error", (event) => {
			wsLogger.logError(event.error, event.message);
		});

		return webSocket;
	}
}
