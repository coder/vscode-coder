import { AxiosInstance } from "axios";
import { spawn } from "child_process";
import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import fs from "fs/promises";
import { ProxyAgent } from "proxy-agent";
import * as vscode from "vscode";
import { errToStr } from "./api-helper";
import { CertificateError } from "./error";
import { FeatureSet } from "./featureSet";
import { getGlobalFlags } from "./globalFlags";
import {
	createRequestMeta,
	logRequestStart,
	logRequestSuccess,
	logRequestError,
	RequestConfigWithMeta,
} from "./logging/netLog";
import { getProxyForUrl } from "./proxy";
import { Storage } from "./storage";
import { expandPath } from "./util";
import { CoderWebSocketClient } from "./websocket/webSocketClient";

export const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Return whether the API will need a token for authorization.
 * If mTLS is in use (as specified by the cert or key files being set) then
 * token authorization is disabled.  Otherwise, it is enabled.
 */
export function needToken(): boolean {
	const cfg = vscode.workspace.getConfiguration();
	const certFile = expandPath(
		String(cfg.get("coder.tlsCertFile") ?? "").trim(),
	);
	const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim());
	return !certFile && !keyFile;
}

/**
 * Create a new agent based off the current settings.
 */
export async function createHttpAgent(): Promise<ProxyAgent> {
	const cfg = vscode.workspace.getConfiguration();
	const insecure = Boolean(cfg.get("coder.insecure"));
	const certFile = expandPath(
		String(cfg.get("coder.tlsCertFile") ?? "").trim(),
	);
	const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim());
	const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim());
	const altHost = expandPath(String(cfg.get("coder.tlsAltHost") ?? "").trim());

	return new ProxyAgent({
		// Called each time a request is made.
		getProxyForUrl: (url: string) => {
			const cfg = vscode.workspace.getConfiguration();
			return getProxyForUrl(
				url,
				cfg.get("http.proxy"),
				cfg.get("coder.proxyBypass"),
			);
		},
		cert: certFile === "" ? undefined : await fs.readFile(certFile),
		key: keyFile === "" ? undefined : await fs.readFile(keyFile),
		ca: caFile === "" ? undefined : await fs.readFile(caFile),
		servername: altHost === "" ? undefined : altHost,
		// rejectUnauthorized defaults to true, so we need to explicitly set it to
		// false if we want to allow self-signed certificates.
		rejectUnauthorized: !insecure,
	});
}

/**
 * Create an sdk instance using the provided URL and token and hook it up to
 * configuration. The token may be undefined if some other form of
 * authentication is being used.
 *
 * Automatically configures logging interceptors that log:
 * - Requests and responses at the trace level
 * - Errors at the error level
 */
export function makeCoderSdk(
	baseUrl: string,
	token: string | undefined,
	storage: Storage,
): Api {
	const restClient = new Api();
	restClient.setHost(baseUrl);
	if (token) {
		restClient.setSessionToken(token);
	}

	// Logging interceptor
	addLoggingInterceptors(restClient.getAxiosInstance(), storage.output);

	restClient.getAxiosInstance().interceptors.request.use(async (config) => {
		// Add headers from the header command.
		Object.entries(await storage.getHeaders(baseUrl)).forEach(
			([key, value]) => {
				config.headers[key] = value;
			},
		);

		// Configure proxy and TLS.
		// Note that by default VS Code overrides the agent.  To prevent this, set
		// `http.proxySupport` to `on` or `off`.
		const agent = await createHttpAgent();
		config.httpsAgent = agent;
		config.httpAgent = agent;
		config.proxy = false;

		return config;
	});

	// Wrap certificate errors.
	restClient.getAxiosInstance().interceptors.response.use(
		(r) => r,
		async (err) => {
			throw await CertificateError.maybeWrap(err, baseUrl, storage.output);
		},
	);

	return restClient;
}

export function addLoggingInterceptors(
	client: AxiosInstance,
	logger: vscode.LogOutputChannel,
) {
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

/**
 * Start or update a workspace and return the updated workspace.
 */
export async function startWorkspaceIfStoppedOrFailed(
	restClient: Api,
	globalConfigDir: string,
	binPath: string,
	workspace: Workspace,
	writeEmitter: vscode.EventEmitter<string>,
	featureSet: FeatureSet,
): Promise<Workspace> {
	// Before we start a workspace, we make an initial request to check it's not already started
	const updatedWorkspace = await restClient.getWorkspace(workspace.id);

	if (!["stopped", "failed"].includes(updatedWorkspace.latest_build.status)) {
		return updatedWorkspace;
	}

	return new Promise((resolve, reject) => {
		const startArgs = [
			...getGlobalFlags(vscode.workspace.getConfiguration(), globalConfigDir),
			"start",
			"--yes",
			workspace.owner_name + "/" + workspace.name,
		];
		if (featureSet.buildReason) {
			startArgs.push(...["--reason", "vscode_connection"]);
		}

		const startProcess = spawn(binPath, startArgs, { shell: true });

		startProcess.stdout.on("data", (data: Buffer) => {
			data
				.toString()
				.split(/\r*\n/)
				.forEach((line: string) => {
					if (line !== "") {
						writeEmitter.fire(line.toString() + "\r\n");
					}
				});
		});

		let capturedStderr = "";
		startProcess.stderr.on("data", (data: Buffer) => {
			data
				.toString()
				.split(/\r*\n/)
				.forEach((line: string) => {
					if (line !== "") {
						writeEmitter.fire(line.toString() + "\r\n");
						capturedStderr += line.toString() + "\n";
					}
				});
		});

		startProcess.on("close", (code: number) => {
			if (code === 0) {
				resolve(restClient.getWorkspace(workspace.id));
			} else {
				let errorText = `"${startArgs.join(" ")}" exited with code ${code}`;
				if (capturedStderr !== "") {
					errorText += `: ${capturedStderr}`;
				}
				reject(new Error(errorText));
			}
		});
	});
}

/**
 * Wait for the latest build to finish while streaming logs to the emitter.
 *
 * Once completed, fetch the workspace again and return it.
 */
export async function waitForBuild(
	restClient: Api,
	webSocketClient: CoderWebSocketClient,
	writeEmitter: vscode.EventEmitter<string>,
	workspace: Workspace,
): Promise<Workspace> {
	// This fetches the initial bunch of logs.
	const logs = await restClient.getWorkspaceBuildLogs(
		workspace.latest_build.id,
	);
	logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"));

	await new Promise<void>((resolve, reject) => {
		const rejectError = (error: unknown) => {
			const baseUrlRaw = restClient.getAxiosInstance().defaults.baseURL!;
			return reject(
				new Error(
					`Failed to watch workspace build on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
				),
			);
		};

		const socket = webSocketClient.watchBuildLogsByBuildId(
			workspace.latest_build.id,
			logs,
		);
		const closeHandler = () => {
			resolve();
		};
		socket.addEventListener("close", closeHandler);
		socket.addEventListener("message", (data) => {
			const log = data.parsedMessage!;
			writeEmitter.fire(log.output + "\r\n");
		});
		socket.addEventListener("error", (error) => {
			// Do not want to trigger the close handler.
			socket.removeEventListener("close", closeHandler);
			socket.close();
			rejectError(error);
		});
	});

	writeEmitter.fire("Build complete\r\n");
	const updatedWorkspace = await restClient.getWorkspace(workspace.id);
	writeEmitter.fire(
		`Workspace is now ${updatedWorkspace.latest_build.status}\r\n`,
	);
	return updatedWorkspace;
}
