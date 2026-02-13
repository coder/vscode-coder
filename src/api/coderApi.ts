import {
	type AxiosResponseHeaders,
	type AxiosInstance,
	type AxiosHeaders,
	type AxiosResponseTransformer,
	isAxiosError,
} from "axios";
import { Api } from "coder/site/src/api/api";
import {
	type ServerSentEvent,
	type GetInboxNotificationResponse,
	type ProvisionerJobLog,
	type Workspace,
	type WorkspaceAgent,
	type WorkspaceAgentLog,
} from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";
import { type ClientOptions } from "ws";

import { watchConfigurationChanges } from "../configWatcher";
import { ClientCertificateError } from "../error/clientCertificateError";
import { toError } from "../error/errorUtils";
import { ServerCertificateError } from "../error/serverCertificateError";
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
import { HttpStatusCode, WebSocketCloseCode } from "../websocket/codes";
import {
	type UnidirectionalStream,
	type CloseEvent,
	type ErrorEvent,
} from "../websocket/eventStreamConnection";
import {
	OneWayWebSocket,
	type OneWayWebSocketInit,
} from "../websocket/oneWayWebSocket";
import {
	ConnectionState,
	ReconnectingWebSocket,
	type SocketFactory,
} from "../websocket/reconnectingWebSocket";
import { SseConnection } from "../websocket/sseConnection";

import { getRefreshCommand, refreshCertificates } from "./certificateRefresh";
import { createHttpAgent } from "./utils";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Configuration settings that affect WebSocket connections.
 * Changes to these settings will trigger WebSocket reconnection.
 */
const webSocketConfigSettings = [
	"coder.headerCommand",
	"coder.insecure",
	"coder.tlsCertFile",
	"coder.tlsKeyFile",
	"coder.tlsCaFile",
	"coder.tlsAltHost",
	"http.proxy",
	"coder.proxyBypass",
	"http.noProxy",
	"http.proxyAuthorization",
	"http.proxyStrictSSL",
] as const;

/**
 * Unified API class that includes both REST API methods from the base Api class
 * and WebSocket methods for real-time functionality.
 */
export class CoderApi extends Api implements vscode.Disposable {
	private readonly reconnectingSockets = new Set<
		ReconnectingWebSocket<never>
	>();
	private readonly configWatcher: vscode.Disposable;

	private constructor(private readonly output: Logger) {
		super();
		this.configWatcher = this.watchConfigChanges();
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
		client.setCredentials(baseUrl, token);

		setupInterceptors(client, output);
		return client;
	}

	getHost(): string | undefined {
		return this.getAxiosInstance().defaults.baseURL;
	}

	getSessionToken(): string | undefined {
		return this.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;
	}

	/**
	 * Set both host and token together. Useful for login/logout/switch to
	 * avoid triggering multiple reconnection events.
	 */
	setCredentials = (
		host: string | undefined,
		token: string | undefined,
	): void => {
		const currentHost = this.getHost();
		const currentToken = this.getSessionToken();

		// We cannot use the super.setHost/setSessionToken methods because they are shadowed here
		const defaults = this.getAxiosInstance().defaults;
		defaults.baseURL = host;
		defaults.headers.common[coderSessionTokenHeader] = token;

		const hostChanged = (currentHost || "") !== (host || "");
		const tokenChanged = (currentToken || "") !== (token || "");

		if (hostChanged || tokenChanged) {
			for (const socket of this.reconnectingSockets) {
				if (host) {
					socket.reconnect();
				} else {
					socket.disconnect(WebSocketCloseCode.NORMAL, "Host cleared");
				}
			}
		}
	};

	override setSessionToken = (token: string): void => {
		this.setCredentials(this.getHost(), token);
	};

	override setHost = (host: string | undefined): void => {
		this.setCredentials(host, this.getSessionToken());
	};

	/**
	 * Permanently dispose all WebSocket connections.
	 * This clears handlers and prevents reconnection.
	 */
	dispose(): void {
		this.configWatcher.dispose();
		for (const socket of this.reconnectingSockets) {
			socket.close();
		}
		this.reconnectingSockets.clear();
	}

	/**
	 * Watch for configuration changes that affect WebSocket connections.
	 * Only reconnects DISCONNECTED sockets since they require an explicit reconnect() call.
	 * Other states will pick up settings naturally.
	 */
	private watchConfigChanges(): vscode.Disposable {
		const settings = webSocketConfigSettings.map((setting) => ({
			setting,
			getValue: () => vscode.workspace.getConfiguration().get(setting),
		}));
		return watchConfigurationChanges(settings, () => {
			const socketsToReconnect = [...this.reconnectingSockets].filter(
				(socket) => socket.state === ConnectionState.DISCONNECTED,
			);
			if (socketsToReconnect.length) {
				this.output.debug(
					`Configuration changed, ${socketsToReconnect.length}/${this.reconnectingSockets.size} socket(s) in DISCONNECTED state`,
				);
				for (const socket of socketsToReconnect) {
					this.output.debug(`Reconnecting WebSocket: ${socket.url}`);
					socket.reconnect();
				}
			}
		});
	}

	watchInboxNotifications = async (
		watchTemplates: string[],
		watchTargets: string[],
		options?: ClientOptions,
	) => {
		return this.createReconnectingSocket(() =>
			this.createOneWayWebSocket<GetInboxNotificationResponse>({
				apiRoute: "/api/v2/notifications/inbox/watch",
				searchParams: {
					format: "plaintext",
					templates: watchTemplates.join(","),
					targets: watchTargets.join(","),
				},
				options,
			}),
		);
	};

	watchWorkspace = async (workspace: Workspace, options?: ClientOptions) => {
		return this.createReconnectingSocket(() =>
			this.createStreamWithSseFallback({
				apiRoute: `/api/v2/workspaces/${workspace.id}/watch-ws`,
				fallbackApiRoute: `/api/v2/workspaces/${workspace.id}/watch`,
				options,
			}),
		);
	};

	watchAgentMetadata = async (
		agentId: WorkspaceAgent["id"],
		options?: ClientOptions,
	) => {
		return this.createReconnectingSocket(() =>
			this.createStreamWithSseFallback({
				apiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata-ws`,
				fallbackApiRoute: `/api/v2/workspaceagents/${agentId}/watch-metadata`,
				options,
			}),
		);
	};

	watchBuildLogsByBuildId = async (
		buildId: string,
		logs: ProvisionerJobLog[],
		options?: ClientOptions,
	) => {
		return this.watchLogs<ProvisionerJobLog>(
			`/api/v2/workspacebuilds/${buildId}/logs`,
			logs,
			options,
		);
	};

	watchWorkspaceAgentLogs = async (
		agentId: string,
		logs: WorkspaceAgentLog[],
		options?: ClientOptions,
	) => {
		return this.watchLogs<WorkspaceAgentLog[]>(
			`/api/v2/workspaceagents/${agentId}/logs`,
			logs,
			options,
		);
	};

	private async watchLogs<TData>(
		apiRoute: string,
		logs: Array<{ id: number }>,
		options?: ClientOptions,
	) {
		const searchParams = new URLSearchParams({ follow: "true" });
		const lastLog = logs.at(-1);
		if (lastLog) {
			searchParams.append("after", lastLog.id.toString());
		}

		return this.createOneWayWebSocket<TData>({
			apiRoute,
			searchParams,
			options,
		});
	}

	private async createOneWayWebSocket<TData>(
		configs: Omit<OneWayWebSocketInit, "location">,
	): Promise<OneWayWebSocket<TData>> {
		const baseUrlRaw = this.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}
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

		const baseUrl = new URL(baseUrlRaw);
		const ws = new OneWayWebSocket<TData>({
			location: baseUrl,
			...configs,
			options: {
				...configs.options,
				agent: httpAgent,
				followRedirects: true,
				headers,
			},
		});

		this.attachStreamLogger(ws);

		// Wait for connection to open before returning
		return await this.waitForOpen(ws);
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
	 * Tries WS first, falls back to SSE on 404.
	 *
	 * Note: The fallback on SSE ignores all passed client options except the headers.
	 */
	private async createStreamWithSseFallback(
		configs: Omit<OneWayWebSocketInit, "location"> & {
			fallbackApiRoute: string;
		},
	): Promise<UnidirectionalStream<ServerSentEvent>> {
		const { fallbackApiRoute, ...socketConfigs } = configs;
		try {
			// createOneWayWebSocket already waits for open
			return await this.createOneWayWebSocket<ServerSentEvent>(socketConfigs);
		} catch (error) {
			if (this.is404Error(error)) {
				this.output.warn(
					`WebSocket failed (${socketConfigs.apiRoute}), using SSE fallback: ${fallbackApiRoute}`,
				);
				const sse = this.createSseConnection(
					fallbackApiRoute,
					socketConfigs.searchParams,
					socketConfigs.options?.headers,
				);
				return await this.waitForOpen(sse);
			}
			throw error;
		}
	}

	/**
	 * Create an SSE connection without waiting for connection.
	 */
	private createSseConnection(
		apiRoute: string,
		searchParams?: Record<string, string> | URLSearchParams,
		optionsHeaders?: Record<string, string>,
	): SseConnection {
		const baseUrlRaw = this.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}
		const url = new URL(baseUrlRaw);
		const sse = new SseConnection({
			location: url,
			apiRoute,
			searchParams,
			axiosInstance: this.getAxiosInstance(),
			optionsHeaders,
			logger: this.output,
		});

		this.attachStreamLogger(sse);
		return sse;
	}

	/**
	 * Wait for a connection to open. Rejects on error.
	 * Preserves the specific connection type (e.g., OneWayWebSocket, SseConnection).
	 */
	private waitForOpen<T extends UnidirectionalStream<unknown>>(
		connection: T,
	): Promise<T> {
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
				connection.close();
				const error = toError(
					event.error,
					event.message || "WebSocket connection error",
				);
				reject(error);
			};

			connection.addEventListener("open", handleOpen);
			connection.addEventListener("error", handleError);
		});
	}

	/**
	 * Check if an error is a 404 Not Found error.
	 */
	private is404Error(error: unknown): boolean {
		const msg = error instanceof Error ? error.message : String(error);
		return msg.includes(String(HttpStatusCode.NOT_FOUND));
	}

	/**
	 * Create a ReconnectingWebSocket and track it for lifecycle management.
	 */
	private async createReconnectingSocket<TData>(
		socketFactory: SocketFactory<TData>,
	): Promise<ReconnectingWebSocket<TData>> {
		const reconnectingSocket = await ReconnectingWebSocket.create<TData>(
			socketFactory,
			this.output,
			{
				onCertificateRefreshNeeded: async () => {
					const refreshCommand = getRefreshCommand();
					if (!refreshCommand) {
						return false;
					}
					return refreshCertificates(refreshCommand, this.output);
				},
			},
			() => this.reconnectingSockets.delete(reconnectingSocket),
		);

		this.reconnectingSockets.add(reconnectingSocket);

		return reconnectingSocket;
	}
}

/**
 * Set up logging and request interceptors for the CoderApi instance.
 */
function setupInterceptors(client: CoderApi, output: Logger): void {
	addLoggingInterceptors(client.getAxiosInstance(), output);

	client.getAxiosInstance().interceptors.request.use(async (config) => {
		const baseUrl = client.getAxiosInstance().defaults.baseURL;
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

	// Wrap certificate errors and handle client certificate errors with refresh.
	client.getAxiosInstance().interceptors.response.use(
		(r) => r,
		async (err: unknown) => {
			const retryResponse = await tryRefreshClientCertificate(
				err,
				client.getAxiosInstance(),
				output,
			);
			if (retryResponse) {
				return retryResponse;
			}

			// Handle other certificate errors.
			const baseUrl = client.getAxiosInstance().defaults.baseURL;
			if (baseUrl) {
				throw await ServerCertificateError.maybeWrap(err, baseUrl, output);
			}
			throw err;
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
					config.transformRequest ?? client.defaults.transformRequest ?? [],
					configWithMeta,
				),
				(data: unknown) => {
					// Log after setting the raw request size
					logRequest(logger, configWithMeta, getLogLevel());
					return data;
				},
			];

			config.transformResponse = wrapResponseTransform(
				config.transformResponse ?? client.defaults.transformResponse ?? [],
				configWithMeta,
			);

			return config;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel());
			throw error;
		},
	);

	client.interceptors.response.use(
		(response) => {
			logResponse(logger, response, getLogLevel());
			return response;
		},
		(error: unknown) => {
			logError(logger, error, getLogLevel());
			throw error;
		},
	);
}

/**
 * Attempts to refresh client certificates and retry the request if the error
 * is a refreshable client certificate error.
 *
 * @returns The retry response if refresh succeeds, or undefined if the error
 *          is not a client certificate error (caller should handle).
 * @throws {ClientCertificateError} If this is a client certificate error.
 */
async function tryRefreshClientCertificate(
	err: unknown,
	axiosInstance: AxiosInstance,
	output: Logger,
): Promise<unknown> {
	const certError = ClientCertificateError.fromError(err);
	if (!certError) {
		return undefined;
	}

	const refreshCommand = getRefreshCommand();
	if (
		!certError.isRefreshable ||
		!refreshCommand ||
		!isAxiosError(err) ||
		!err.config
	) {
		throw certError;
	}

	// _certRetried is per-request (Axios creates fresh config per request).
	const config = err.config as RequestConfigWithMeta & {
		_certRetried?: boolean;
	};
	if (config._certRetried) {
		throw certError;
	}
	config._certRetried = true;

	output.info(
		`Client certificate error (alert ${certError.alertCode}), attempting refresh...`,
	);
	const success = await refreshCertificates(refreshCommand, output);
	if (!success) {
		throw certError;
	}

	// Create new agent with refreshed certificates.
	const agent = await createHttpAgent(vscode.workspace.getConfiguration());
	config.httpsAgent = agent;
	config.httpAgent = agent;

	// Retry the request.
	output.info("Retrying request with refreshed certificates...");
	return axiosInstance.request(config);
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
	const contentLength = headers["content-length"] as unknown;
	if (typeof contentLength === "string") {
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
