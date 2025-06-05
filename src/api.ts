import { AxiosInstance } from "axios";
import { spawn } from "child_process";
import { Api } from "coder/site/src/api/api";
import {
	ProvisionerJobLog,
	Workspace,
} from "coder/site/src/api/typesGenerated";
import { FetchLikeInit } from "eventsource";
import fs from "fs/promises";
import { ProxyAgent } from "proxy-agent";
import * as vscode from "vscode";
import * as ws from "ws";
import { errToStr } from "./api-helper";
import { CertificateError } from "./error";
import { getHeaderArgs } from "./headers";
import { getProxyForUrl } from "./proxy";
import { Storage } from "./storage";
import { expandPath } from "./util";

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
 * configuration.  The token may be undefined if some other form of
 * authentication is being used.
 */
export async function makeCoderSdk(
	baseUrl: string,
	token: string | undefined,
	storage: Storage,
): Promise<Api> {
	const restClient = new Api();
	restClient.setHost(baseUrl);
	if (token) {
		restClient.setSessionToken(token);
	}

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
			throw await CertificateError.maybeWrap(err, baseUrl, storage);
		},
	);

	return restClient;
}

/**
 * Creates a fetch adapter using an Axios instance that returns streaming responses.
 * This can be used with APIs that accept fetch-like interfaces.
 */
export function createStreamingFetchAdapter(axiosInstance: AxiosInstance) {
	return async (url: string | URL, init?: FetchLikeInit) => {
		const urlStr = url.toString();

		const response = await axiosInstance.request({
			url: urlStr,
			signal: init?.signal,
			headers: init?.headers as Record<string, string>,
			responseType: "stream",
			validateStatus: () => true, // Don't throw on any status code
		});
		const stream = new ReadableStream({
			start(controller) {
				response.data.on("data", (chunk: Buffer) => {
					controller.enqueue(chunk);
				});

				response.data.on("end", () => {
					controller.close();
				});

				response.data.on("error", (err: Error) => {
					controller.error(err);
				});
			},

			cancel() {
				response.data.destroy();
				return Promise.resolve();
			},
		});

		return {
			body: {
				getReader: () => stream.getReader(),
			},
			url: urlStr,
			status: response.status,
			redirected: response.request.res.responseUrl !== urlStr,
			headers: {
				get: (name: string) => {
					const value = response.headers[name.toLowerCase()];
					return value === undefined ? null : String(value);
				},
			},
		};
	};
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
): Promise<Workspace> {
	// Before we start a workspace, we make an initial request to check it's not already started
	const updatedWorkspace = await restClient.getWorkspace(workspace.id);

	if (!["stopped", "failed"].includes(updatedWorkspace.latest_build.status)) {
		return updatedWorkspace;
	}

	return new Promise((resolve, reject) => {
		const startArgs = [
			"--global-config",
			globalConfigDir,
			...getHeaderArgs(vscode.workspace.getConfiguration()),
			"start",
			"--yes",
			workspace.owner_name + "/" + workspace.name,
		];
		const startProcess = spawn(binPath, startArgs);

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
	writeEmitter: vscode.EventEmitter<string>,
	workspace: Workspace,
): Promise<Workspace> {
	const baseUrlRaw = restClient.getAxiosInstance().defaults.baseURL;
	if (!baseUrlRaw) {
		throw new Error("No base URL set on REST client");
	}

	// This fetches the initial bunch of logs.
	const logs = await restClient.getWorkspaceBuildLogs(
		workspace.latest_build.id,
	);
	logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"));

	// This follows the logs for new activity!
	// TODO: watchBuildLogsByBuildId exists, but it uses `location`.
	//       Would be nice if we could use it here.
	let path = `/api/v2/workspacebuilds/${workspace.latest_build.id}/logs?follow=true`;
	if (logs.length) {
		path += `&after=${logs[logs.length - 1].id}`;
	}

	const agent = await createHttpAgent();
	await new Promise<void>((resolve, reject) => {
		try {
			const baseUrl = new URL(baseUrlRaw);
			const proto = baseUrl.protocol === "https:" ? "wss:" : "ws:";
			const socketUrlRaw = `${proto}//${baseUrl.host}${path}`;
			const token = restClient.getAxiosInstance().defaults.headers.common[
				coderSessionTokenHeader
			] as string | undefined;
			const socket = new ws.WebSocket(new URL(socketUrlRaw), {
				agent: agent,
				followRedirects: true,
				headers: token
					? {
							[coderSessionTokenHeader]: token,
						}
					: undefined,
			});
			socket.binaryType = "nodebuffer";
			socket.on("message", (data) => {
				const buf = data as Buffer;
				const log = JSON.parse(buf.toString()) as ProvisionerJobLog;
				writeEmitter.fire(log.output + "\r\n");
			});
			socket.on("error", (error) => {
				reject(
					new Error(
						`Failed to watch workspace build using ${socketUrlRaw}: ${errToStr(error, "no further details")}`,
					),
				);
			});
			socket.on("close", () => {
				resolve();
			});
		} catch (error) {
			// If this errors, it is probably a malformed URL.
			reject(
				new Error(
					`Failed to watch workspace build on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
				),
			);
		}
	});

	writeEmitter.fire("Build complete\r\n");
	const updatedWorkspace = await restClient.getWorkspace(workspace.id);
	writeEmitter.fire(
		`Workspace is now ${updatedWorkspace.latest_build.status}\r\n`,
	);
	return updatedWorkspace;
}
