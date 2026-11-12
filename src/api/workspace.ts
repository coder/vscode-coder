import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { errToStr } from "../error/normalize";
import {
	getCliProcessEnv,
	getGlobalFlags,
	type CliAuth,
} from "../settings/cli";

import { createWorkspaceIdentifier } from "./models";

import type { Api } from "coder/site/src/api/api";
import type {
	CreateWorkspaceBuildOnSuccessRequest,
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

import type { ServerFeatureSet } from "../featureSet";
import type {
	EventHandler,
	UnidirectionalStream,
} from "../websocket/eventStreamConnection";
import type { OneWayWebSocket } from "../websocket/oneWayWebSocket";

import type { CoderApi } from "./coderApi";

const BUILD_REASON = "vscode_connection";

/** Opens a stream once; subsequent open() calls are no-ops until closed. */
export class LazyStream<T> {
	private stream: UnidirectionalStream<T> | null = null;
	private opening: Promise<void> | null = null;

	async open(factory: () => Promise<UnidirectionalStream<T>>): Promise<void> {
		if (this.stream) return;

		// Deduplicate concurrent calls; close() clears the reference to cancel.
		if (!this.opening) {
			const promise = factory().then((s) => {
				if (this.opening === promise) {
					this.stream = s;
					this.opening = null;
				} else {
					s.close();
				}
			});
			this.opening = promise;
		}
		await this.opening;
	}

	close(): void {
		this.stream?.close();
		this.stream = null;
		this.opening = null;
	}
}

type BuildApi = Pick<Api, "getWorkspace" | "postWorkspaceBuild">;

interface CliContext {
	restClient: BuildApi;
	auth: CliAuth;
	binPath: string;
	workspace: Workspace;
	write: (data: string) => void;
	serverFeatures: ServerFeatureSet;
}

/** Streams CLI output via `ctx.write`; rejects with stderr on non-zero exit. */
function runCliCommand(ctx: CliContext, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const fullArgs = [
			...getGlobalFlags(vscode.workspace.getConfiguration(), ctx.auth),
			...args,
			"--",
			createWorkspaceIdentifier(ctx.workspace),
		];
		const proc = spawn(ctx.binPath, fullArgs, { env: getCliProcessEnv() });
		// Unexpected prompts EOF instead of hanging forever.
		proc.stdin.end();

		proc.stdout.on("data", (data: Buffer) => {
			ctx.write(data.toString());
		});

		let capturedStderr = "";
		proc.stderr.on("data", (data: Buffer) => {
			const text = data.toString();
			ctx.write(text);
			capturedStderr += text;
		});

		// Settle on ENOENT/EACCES; later `close` rejects are then no-ops.
		proc.on("error", reject);

		proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			if (code === 0) {
				resolve();
				return;
			}
			const exit =
				code !== null ? `code ${code}` : `signal ${signal ?? "unknown"}`;
			let msg = `"${fullArgs.join(" ")}" exited with ${exit}`;
			if (capturedStderr) msg += `: ${capturedStderr}`;
			reject(new Error(msg));
		});
	});
}

/**
 * Start a stopped or failed workspace using `coder start`.
 * No-ops if the workspace is already running.
 */
export async function startWorkspace(ctx: CliContext): Promise<Workspace> {
	if (!["stopped", "failed"].includes(ctx.workspace.latest_build.status)) {
		return ctx.workspace;
	}

	await runCliCommand(ctx, ["start", "--yes", "--reason", BUILD_REASON]);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Update a workspace to the latest template version. Callers must collect
 * any newly-required parameters via `collectUpdateParameters` first; this
 * function does not prompt. On servers before 2.36, `coder update` takes
 * two builds.
 */
export async function updateWorkspace(
	ctx: CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	if (ctx.serverFeatures.onSuccessBuild) {
		return updateWorkspaceInOneBuild(ctx, parameters);
	}

	const paramArgs = parameters.flatMap((p) => [
		"--parameter",
		`${p.name}=${p.value}`,
	]);
	await runCliCommand(ctx, ["update", ...paramArgs]);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Stop and start in one build, so nothing can take the slot in between. The
 * returned workspace carries the stop build; the server starts it after.
 */
async function updateWorkspaceInOneBuild(
	ctx: CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	// The build may have changed while parameters were collected.
	const workspace = await ctx.restClient.getWorkspace(ctx.workspace.id);
	const start: CreateWorkspaceBuildOnSuccessRequest = {
		transition: "start",
		rich_parameter_values: parameters,
	};
	const running = workspace.latest_build.status === "running";

	ctx.write(
		`${running ? "Restarting" : "Starting"} workspace with the updated template...\r\n`,
	);
	const build = await ctx.restClient.postWorkspaceBuild(
		workspace.id,
		running
			? { transition: "stop", reason: BUILD_REASON, on_success: start }
			: {
					...start,
					reason: BUILD_REASON,
					// Pinning a follow-up build needs template update permission,
					// so only a lone start can name the version.
					template_version_id: workspace.template_active_version_id,
				},
	);
	return { ...workspace, latest_build: build };
}

/**
 * Streams build logs in real-time via a callback. Resolves once the socket
 * opens and rejects if the handshake fails.
 */
export async function streamBuildLogs(
	client: CoderApi,
	onOutput: (line: string) => void,
	buildId: string,
): Promise<OneWayWebSocket<ProvisionerJobLog>> {
	const socket = await client.watchBuildLogsByBuildId(buildId, []);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			onOutput(errToStr(data.parseError, "Failed to parse message"));
		} else {
			onOutput(data.parsedMessage.output);
		}
	});
	onErrorAfterOpen(socket, (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching workspace build logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	await socket.opened;
	void socket.closed.then(() => onOutput("Build complete"));
	return socket;
}

/**
 * Streams agent logs in real-time via a callback. Resolves once the socket
 * opens and rejects if the handshake fails.
 */
export async function streamAgentLogs(
	client: CoderApi,
	onOutput: (line: string) => void,
	agentId: string,
): Promise<OneWayWebSocket<WorkspaceAgentLog[]>> {
	const socket = await client.watchWorkspaceAgentLogs(agentId, []);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			onOutput(errToStr(data.parseError, "Failed to parse message"));
		} else {
			for (const log of data.parsedMessage) {
				onOutput(log.output);
			}
		}
	});
	onErrorAfterOpen(socket, (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching agent logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	await socket.opened;
	return socket;
}

/** Handshake errors are left to `socket.opened`, which rejects with them. */
function onErrorAfterOpen<T>(
	socket: OneWayWebSocket<T>,
	handler: EventHandler<T, "error">,
): void {
	let isOpen = false;
	socket.addEventListener("open", () => {
		isOpen = true;
	});
	socket.addEventListener("error", (event) => {
		if (isOpen) {
			handler(event);
		}
	});
}
