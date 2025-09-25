import { type AxiosInstance } from "axios";
import { Api } from "coder/site/src/api/api";
import {
	type GetInboxNotificationResponse,
	type ProvisionerJobLog,
	type ServerSentEvent,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { type WorkspaceConfiguration } from "vscode";
import { type ClientOptions } from "ws";

import { CertificateError } from "../error";
import { getHeaderCommand, getHeaders } from "../headers";
import { createHttpAgent } from "./utils";
import {
	createRequestMeta,
	logRequest,
	logError,
	logResponse,
} from "../logging/httpLogger";
import { type Logger } from "../logging/logger";
import {
	type RequestConfigWithMeta,
	HttpClientLogLevel,
} from "../logging/types";
import { WsLogger } from "../logging/wsLogger";
import {
	OneWayWebSocket,
	type OneWayWebSocketInit,
} from "../websocket/oneWayWebSocket";

const coderSessionTokenHeader = "Coder-Session-Token";

type WorkspaceConfigurationProvider = () => WorkspaceConfiguration;

/**
 * Unified API class that includes both REST API methods from the base Api class
 * and WebSocket methods for real-time functionality.
 */
export class CoderApi extends Api {
	private constructor(
		private readonly output: Logger,
		private readonly configProvider: WorkspaceConfigurationProvider,
	) {
		super();
	}

	/**
	 * Create a new CoderApi instance with the provided configuration.
	 * Automatically sets up logging interceptors and certificate handling.
	 */
	static create(
		baseUrl: string,
		token: string | undefined,
		output: Logger,
		configProvider: WorkspaceConfigurationProvider,
	): CoderApi {
		const client = new CoderApi(output, configProvider);
		client.setHost(baseUrl);
		if (token) {
			client.setSessionToken(token);
		}

		setupInterceptors(client, baseUrl, output, configProvider);
		return client;
	}

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

	private createWebSocket<TData = unknown>(
		configs: Omit<OneWayWebSocketInit, "location">,
	) {
		const baseUrlRaw = this.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}

		const baseUrl = new URL(baseUrlRaw);
		const token = this.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;

		const httpAgent = createHttpAgent(this.configProvider());
		const webSocket = new OneWayWebSocket<TData>({
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
		const wsLogger = new WsLogger(this.output, pathWithQuery);
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

/**
 * Set up logging and request interceptors for the CoderApi instance.
 */
function setupInterceptors(
	client: CoderApi,
	baseUrl: string,
	output: Logger,
	configProvider: WorkspaceConfigurationProvider,
): void {
	addLoggingInterceptors(client.getAxiosInstance(), output, configProvider);

	client.getAxiosInstance().interceptors.request.use(async (config) => {
		const headers = await getHeaders(
			baseUrl,
			getHeaderCommand(configProvider()),
			output,
		);
		// Add headers from the header command.
		Object.entries(headers).forEach(([key, value]) => {
			config.headers[key] = value;
		});

		// Configure proxy and TLS.
		// Note that by default VS Code overrides the agent. To prevent this, set
		// `http.proxySupport` to `on` or `off`.
		const agent = createHttpAgent(configProvider());
		config.httpsAgent = agent;
		config.httpAgent = agent;
		config.proxy = false;

		return config;
	});

	// Wrap certificate errors.
	client.getAxiosInstance().interceptors.response.use(
		(r) => r,
		async (err) => {
			throw await CertificateError.maybeWrap(err, baseUrl, output);
		},
	);
}

function addLoggingInterceptors(
	client: AxiosInstance,
	logger: Logger,
	configProvider: WorkspaceConfigurationProvider,
) {
	client.interceptors.request.use(
		(config) => {
			const configWithMeta = config as RequestConfigWithMeta;
			configWithMeta.metadata = createRequestMeta();
			logRequest(logger, configWithMeta, getLogLevel(configProvider()));
			return config;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel(configProvider()));
			return Promise.reject(error);
		},
	);

	client.interceptors.response.use(
		(response) => {
			logResponse(logger, response, getLogLevel(configProvider()));
			return response;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel(configProvider()));
			return Promise.reject(error);
		},
	);
}

function getLogLevel(cfg: WorkspaceConfiguration): HttpClientLogLevel {
	const logLevelStr = cfg
		.get(
			"coder.httpClientLogLevel",
			HttpClientLogLevel[HttpClientLogLevel.BASIC],
		)
		.toUpperCase();
	return HttpClientLogLevel[logLevelStr as keyof typeof HttpClientLogLevel];
}
