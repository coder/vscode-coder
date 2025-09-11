import { AxiosInstance } from "axios";
import { Api } from "coder/site/src/api/api";
import {
	GetInboxNotificationResponse,
	ProvisionerJobLog,
	ServerSentEvent,
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { type WorkspaceConfiguration } from "vscode";
import { ClientOptions } from "ws";
import { CertificateError } from "../error";
import { getHeaderCommand, getHeaders } from "../headers";
import { Logger } from "../logging/logger";
import {
	createRequestMeta,
	logRequestError,
	logRequestStart,
	logRequestSuccess,
	RequestConfigWithMeta,
	WsLogger,
} from "../logging/netLog";
import { OneWayCodeWebSocket } from "../websocket/oneWayCodeWebSocket";
import { createHttpAgent } from "./auth";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Unified API class that includes both REST API methods from the base Api class
 * and WebSocket methods for real-time functionality.
 */
export class CodeApi extends Api {
	private constructor(
		private readonly output: Logger,
		private readonly cfg: WorkspaceConfiguration,
	) {
		super();
	}

	/**
	 * Create a new CodeApi instance with the provided configuration.
	 * Automatically sets up logging interceptors and certificate handling.
	 */
	static create(
		baseUrl: string,
		token: string | undefined,
		output: Logger,
		cfg: WorkspaceConfiguration,
	): CodeApi {
		const client = new CodeApi(output, cfg);
		client.setHost(baseUrl);
		if (token) {
			client.setSessionToken(token);
		}

		setupInterceptors(client, baseUrl, output, cfg);
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

	private createWebSocket<TData = unknown>(configs: {
		apiRoute: string;
		protocols?: string | string[];
		searchParams?: Record<string, string> | URLSearchParams;
		options?: ClientOptions;
	}) {
		const baseUrlRaw = this.getAxiosInstance().defaults.baseURL;
		if (!baseUrlRaw) {
			throw new Error("No base URL set on REST client");
		}

		const baseUrl = new URL(baseUrlRaw);
		const token = this.getAxiosInstance().defaults.headers.common[
			coderSessionTokenHeader
		] as string | undefined;

		const httpAgent = createHttpAgent(this.cfg);
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
 * Set up logging and request interceptors for the CodeApi instance.
 */
function setupInterceptors(
	client: CodeApi,
	baseUrl: string,
	output: Logger,
	cfg: WorkspaceConfiguration,
): void {
	addLoggingInterceptors(client.getAxiosInstance(), output);

	client.getAxiosInstance().interceptors.request.use(async (config) => {
		const headers = await getHeaders(baseUrl, getHeaderCommand(cfg), output);
		// Add headers from the header command.
		Object.entries(headers).forEach(([key, value]) => {
			config.headers[key] = value;
		});

		// Configure proxy and TLS.
		// Note that by default VS Code overrides the agent. To prevent this, set
		// `http.proxySupport` to `on` or `off`.
		const agent = createHttpAgent(cfg);
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
			const meta = createRequestMeta();
			(config as RequestConfigWithMeta).metadata = meta;
			logRequestStart(logger, meta.requestId, config);
			return config;
		},
		(error: unknown) => {
			logRequestError(logger, error);
			return Promise.reject(error);
		},
	);

	client.interceptors.response.use(
		(response) => {
			const meta = (response.config as RequestConfigWithMeta).metadata;
			if (meta) {
				logRequestSuccess(logger, meta, response);
			}
			return response;
		},
		(error: unknown) => {
			logRequestError(logger, error);
			return Promise.reject(error);
		},
	);
}
