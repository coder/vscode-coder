import {
	type AxiosResponseHeaders,
	type AxiosInstance,
	type AxiosHeaders,
	type AxiosResponseTransformer,
} from "axios";
import { Api } from "coder/site/src/api/api";
import {
	type GetInboxNotificationResponse,
	type ProvisionerJobLog,
	type ServerSentEvent,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";
import { type ClientOptions } from "ws";

import { CertificateError } from "../error";
import { getHeaderCommand, getHeaders } from "../headers";
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
import { serializeValue, sizeOf } from "../logging/utils";
import { WsLogger } from "../logging/wsLogger";
import {
	OneWayWebSocket,
	type OneWayWebSocketInit,
} from "../websocket/oneWayWebSocket";

import { createHttpAgent } from "./utils";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Unified API class that includes both REST API methods from the base Api class
 * and WebSocket methods for real-time functionality.
 */
export class CoderApi extends Api {
	private constructor(private readonly output: Logger) {
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
	): CoderApi {
		const client = new CoderApi(output);
		client.setHost(baseUrl);
		if (token) {
			client.setSessionToken(token);
		}

		setupInterceptors(client, baseUrl, output);
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

		const httpAgent = createHttpAgent(vscode.workspace.getConfiguration());
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
): void {
	addLoggingInterceptors(client.getAxiosInstance(), output);

	client.getAxiosInstance().interceptors.request.use(async (config) => {
		const headers = await getHeaders(
			baseUrl,
			getHeaderCommand(vscode.workspace.getConfiguration()),
			output,
		);
		// Add headers from the header command.
		Object.entries(headers).forEach(([key, value]) => {
			config.headers[key] = value;
		});

		// Configure proxy and TLS.
		// Note that by default VS Code overrides the agent. To prevent this, set
		// `http.proxySupport` to `on` or `off`.
		const agent = createHttpAgent(vscode.workspace.getConfiguration());
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

function addLoggingInterceptors(client: AxiosInstance, logger: Logger) {
	client.interceptors.request.use(
		(config) => {
			const configWithMeta = config as RequestConfigWithMeta;
			configWithMeta.metadata = createRequestMeta();

			config.transformRequest = [
				...wrapRequestTransform(
					config.transformRequest || client.defaults.transformRequest || [],
					configWithMeta,
				),
				(data) => {
					// Log after setting the raw request size
					logRequest(logger, configWithMeta, getLogLevel());
					return data;
				},
			];

			config.transformResponse = wrapResponseTransform(
				config.transformResponse || client.defaults.transformResponse || [],
				configWithMeta,
			);

			return config;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel());
			return Promise.reject(error);
		},
	);

	client.interceptors.response.use(
		(response) => {
			logResponse(logger, response, getLogLevel());
			return response;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel());
			return Promise.reject(error);
		},
	);
}

function wrapRequestTransform(
	transformer: AxiosResponseTransformer | AxiosResponseTransformer[],
	config: RequestConfigWithMeta,
): AxiosResponseTransformer[] {
	return [
		(data: unknown, headers: AxiosHeaders) => {
			const transformerArray = Array.isArray(transformer)
				? transformer
				: [transformer];

			// Transform the request first then estimate the size
			const result = transformerArray.reduce(
				(d, fn) => fn.call(config, d, headers),
				data,
			);

			config.rawRequestSize = getSize(config.headers, result);

			return result;
		},
	];
}

function wrapResponseTransform(
	transformer: AxiosResponseTransformer | AxiosResponseTransformer[],
	config: RequestConfigWithMeta,
): AxiosResponseTransformer[] {
	return [
		(data: unknown, headers: AxiosResponseHeaders, status?: number) => {
			// estimate the size before transforming the response
			config.rawResponseSize = getSize(headers, data);

			const transformerArray = Array.isArray(transformer)
				? transformer
				: [transformer];

			return transformerArray.reduce(
				(d, fn) => fn.call(config, d, headers, status),
				data,
			);
		},
	];
}

function getSize(headers: AxiosHeaders, data: unknown): number | undefined {
	const contentLength = headers["content-length"];
	if (contentLength !== undefined) {
		return parseInt(contentLength, 10);
	}

	const size = sizeOf(data);
	if (size !== undefined) {
		return size;
	}

	// Fallback
	const stringified = serializeValue(data);
	return stringified === null ? undefined : Buffer.byteLength(stringified);
}

function getLogLevel(): HttpClientLogLevel {
	const logLevelStr = vscode.workspace
		.getConfiguration()
		.get(
			"coder.httpClientLogLevel",
			HttpClientLogLevel[HttpClientLogLevel.BASIC],
		)
		.toUpperCase();
	return HttpClientLogLevel[logLevelStr as keyof typeof HttpClientLogLevel];
}
