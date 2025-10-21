import {
	type AxiosResponseHeaders,
	type AxiosInstance,
	type AxiosHeaders,
	type AxiosResponseTransformer,
} from "axios";
import { Api } from "coder/site/src/api/api";
import {
	type ServerSentEvent,
	type GetInboxNotificationResponse,
	type ProvisionerJobLog,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";
import { type ClientOptions, type CloseEvent, type ErrorEvent } from "ws";

import { CertificateError } from "../error";
import { getHeaderCommand, getHeaders } from "../headers";
import { EventStreamLogger } from "../logging/eventStreamLogger";
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
import { sizeOf } from "../logging/utils";
import { type UnidirectionalStream } from "../websocket/eventStreamConnection";
import {
	OneWayWebSocket,
	type OneWayWebSocketInit,
} from "../websocket/oneWayWebSocket";
import { SseConnection } from "../websocket/sseConnection";

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

	watchInboxNotifications = async (
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

	watchWorkspace = async (workspace: Workspace, options?: ClientOptions) => {
		return this.createWebSocketWithFallback<ServerSentEvent>({
			apiRoute: `/api/v2/workspaces/${workspace.id}/watch-ws`,
			fallbackApiRoute: `/api/v2/workspaces/${workspace.id}/watch`,
			options,
		});
	};

	watchAgentMetadata = async (
		agentId: WorkspaceAgent["id"],
		options?: ClientOptions,
	) => {
		return this.createWebSocketWithFallback<ServerSentEvent>({
			apiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata-ws`,
			fallbackApiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata`,
			options,
		});
	};

	watchBuildLogsByBuildId = async (
		buildId: string,
		logs: ProvisionerJobLog[],
		options?: ClientOptions,
	) => {
		const searchParams = new URLSearchParams({ follow: "true" });
		const lastLog = logs.at(-1);
		if (lastLog) {
			searchParams.append("after", lastLog.id.toString());
		}

		return this.createWebSocket<ProvisionerJobLog>({
			apiRoute: `/api/v2/workspacebuilds/${buildId}/logs`,
			searchParams,
			options,
		});
	};

	private async createWebSocket<TData = unknown>(
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

		const headersFromCommand = await getHeaders(
			baseUrlRaw,
			getHeaderCommand(vscode.workspace.getConfiguration()),
			this.output,
		);

		const httpAgent = await createHttpAgent(
			vscode.workspace.getConfiguration(),
		);

		/**
		 * Similar to the REST client, we want to prioritize headers in this order (highest to lowest):
		 * 1. Headers from the header command
		 * 2. Any headers passed directly to this function
		 * 3. Coder session token from the Api client (if set)
		 */
		const headers = {
			...(token ? { [coderSessionTokenHeader]: token } : {}),
			...configs.options?.headers,
			...headersFromCommand,
		};

		const webSocket = new OneWayWebSocket<TData>({
			location: baseUrl,
			...configs,
			options: {
				...configs.options,
				agent: httpAgent,
				followRedirects: true,
				headers,
			},
		});

		this.attachStreamLogger(webSocket);
		return webSocket;
	}

	private attachStreamLogger<TData>(
		connection: UnidirectionalStream<TData>,
	): void {
		const url = new URL(connection.url);
		const logger = new EventStreamLogger(
			this.output,
			url.pathname + url.search,
			url.protocol.startsWith("http") ? "SSE" : "WS",
		);
		logger.logConnecting();

		connection.addEventListener("open", () => logger.logOpen());
		connection.addEventListener("close", (event: CloseEvent) =>
			logger.logClose(event.code, event.reason),
		);
		connection.addEventListener("error", (event: ErrorEvent) =>
			logger.logError(event.error, event.message),
		);
		connection.addEventListener("message", (event) =>
			logger.logMessage(event.sourceEvent.data),
		);
	}

	/**
	 * Create a WebSocket connection with SSE fallback on 404.
	 *
	 * Note: The fallback on SSE ignores all passed client options except the headers.
	 */
	private async createWebSocketWithFallback<TData = unknown>(configs: {
		apiRoute: string;
		fallbackApiRoute: string;
		searchParams?: Record<string, string> | URLSearchParams;
		options?: ClientOptions;
	}): Promise<UnidirectionalStream<TData>> {
		let webSocket: OneWayWebSocket<TData>;
		try {
			webSocket = await this.createWebSocket<TData>({
				apiRoute: configs.apiRoute,
				searchParams: configs.searchParams,
				options: configs.options,
			});
		} catch {
			// Failed to create WebSocket, use SSE fallback
			return this.createSseFallback<TData>(
				configs.fallbackApiRoute,
				configs.searchParams,
				configs.options?.headers,
			);
		}

		return this.waitForConnection(webSocket, () =>
			this.createSseFallback<TData>(
				configs.fallbackApiRoute,
				configs.searchParams,
				configs.options?.headers,
			),
		);
	}

	private waitForConnection<TData>(
		connection: UnidirectionalStream<TData>,
		onNotFound?: () => Promise<UnidirectionalStream<TData>>,
	): Promise<UnidirectionalStream<TData>> {
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				connection.removeEventListener("open", handleOpen);
				connection.removeEventListener("error", handleError);
			};

			const handleOpen = () => {
				cleanup();
				resolve(connection);
			};

			const handleError = (event: ErrorEvent) => {
				cleanup();
				const is404 =
					event.message?.includes("404") ||
					event.error?.message?.includes("404");

				if (is404 && onNotFound) {
					connection.close();
					onNotFound().then(resolve).catch(reject);
				} else {
					reject(event.error || new Error(event.message));
				}
			};

			connection.addEventListener("open", handleOpen);
			connection.addEventListener("error", handleError);
		});
	}

	/**
	 * Create SSE fallback connection
	 */
	private async createSseFallback<TData = unknown>(
		apiRoute: string,
		searchParams?: Record<string, string> | URLSearchParams,
		optionsHeaders?: Record<string, string>,
	): Promise<UnidirectionalStream<TData>> {
		this.output.warn(`WebSocket failed, using SSE fallback: ${apiRoute}`);

		const baseUrlRaw = this.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}

		const baseUrl = new URL(baseUrlRaw);
		const sseConnection = new SseConnection({
			location: baseUrl,
			apiRoute,
			searchParams,
			axiosInstance: this.getAxiosInstance(),
			optionsHeaders: optionsHeaders,
			logger: this.output,
		});

		this.attachStreamLogger(sseConnection);
		return this.waitForConnection(sseConnection);
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
		for (const [key, value] of Object.entries(headers)) {
			config.headers[key] = value;
		}

		// Configure proxy and TLS.
		// Note that by default VS Code overrides the agent. To prevent this, set
		// `http.proxySupport` to `on` or `off`.
		const agent = await createHttpAgent(vscode.workspace.getConfiguration());
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

			// Transform the request first then get the size (measure what's sent over the wire)
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
			// Get the size before transforming the response (measure what's sent over the wire)
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
		return Number.parseInt(contentLength, 10);
	}

	return sizeOf(data);
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
