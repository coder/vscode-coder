import { Api } from "coder/site/src/api/api";
import {
	GetInboxNotificationResponse,
	ProvisionerJobLog,
	ServerSentEvent,
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import { ClientOptions } from "ws";
import { coderSessionTokenHeader } from "../api";
import { errToStr } from "../api-helper";
import { Storage } from "../storage";
import { OneWayCodeWebSocket } from "./oneWayCodeWebSocket";

/**
 * WebSocket client for Coder API connections.
 *
 * Automatically configures logging for WebSocket events:
 * - Connection attempts and successful opens at the trace level
 * - Connection closes at the trace level
 * - Errors at the error level
 */
export class CoderWebSocketClient {
	constructor(
		private readonly client: Api,
		private readonly httpAgent: ProxyAgent,
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

		// We shouldn't need to worry about this throwing. Whilst `baseURL` could
		// be an invalid URL, that would've caused issues before we got to here.
		const baseUrl = new URL(baseUrlRaw);
		const token = this.client.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;

		// Log WebSocket connection attempt
		this.storage.output.trace(
			`Creating WebSocket connection to ${configs.apiRoute}`,
		);

		const webSocket = new OneWayCodeWebSocket<TData>({
			location: baseUrl,
			...configs,
			options: {
				agent: this.httpAgent,
				followRedirects: true,
				headers: token
					? {
							[coderSessionTokenHeader]: token,
							...configs.options?.headers,
						}
					: configs.options?.headers,
				...configs.options,
			},
		});

		// Add logging for WebSocket events
		webSocket.addEventListener("open", () => {
			this.storage.output.trace(
				`WebSocket connection opened to ${configs.apiRoute}`,
			);
		});

		webSocket.addEventListener("close", (event) => {
			this.storage.output.trace(
				`WebSocket connection closed to ${configs.apiRoute}, code: ${event.code}, reason: ${event.reason}`,
			);
		});

		webSocket.addEventListener("error", (event) => {
			const err = errToStr(
				event.error,
				`Got empty error while monitoring ${configs.apiRoute}`,
			);
			this.storage.output.error(err);
		});

		return webSocket;
	}
}
