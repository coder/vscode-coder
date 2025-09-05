import { Api } from "coder/site/src/api/api";
import {
	GetInboxNotificationResponse,
	ServerSentEvent,
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import { ClientOptions } from "ws";
import { coderSessionTokenHeader } from "../api";
import { OneWayCodeWebSocket } from "./OneWayCodeWebSocket";

export function watchInboxNotifications(
	client: Api,
	httpAgent: ProxyAgent,
	watchTemplates: string[],
	watchTargets: string[],
	options?: ClientOptions,
) {
	return createWebSocket<GetInboxNotificationResponse>(client, httpAgent, {
		apiRoute: "/api/v2/notifications/inbox/watch",
		searchParams: {
			format: "plaintext",
			templates: watchTemplates.join(","),
			targets: watchTargets.join(","),
		},
		options,
	});
}

export function watchWorkspace(
	client: Api,
	httpAgent: ProxyAgent,
	workspace: Workspace,
	options?: ClientOptions,
) {
	return createWebSocket<ServerSentEvent>(client, httpAgent, {
		apiRoute: `/api/v2/workspaces/${workspace.id}/watch-ws`,
		options,
	});
}

export function watchAgentMetadata(
	client: Api,
	httpAgent: ProxyAgent,
	agentId: WorkspaceAgent["id"],
	options?: ClientOptions,
) {
	return createWebSocket<ServerSentEvent>(client, httpAgent, {
		apiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata-ws`,
		options,
	});
}

function createWebSocket<TData = unknown>(
	client: Api,
	httpAgent: ProxyAgent,
	configs: {
		apiRoute: string;
		protocols?: string | string[];
		searchParams?: Record<string, string> | URLSearchParams;
		options?: ClientOptions;
	},
) {
	// TODO Add interceptor logging here
	const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
	if (!baseUrlRaw) {
		throw new Error("No base URL set on REST client");
	}
	// We shouldn't need to worry about this throwing. Whilst `baseURL` could
	// be an invalid URL, that would've caused issues before we got to here.
	const baseUrl = new URL(baseUrlRaw);
	const token = client.getAxiosInstance().defaults.headers.common[
		coderSessionTokenHeader
	] as string | undefined;
	return new OneWayCodeWebSocket<TData>({
		location: baseUrl,
		...configs,
		options: {
			agent: httpAgent,
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
}
