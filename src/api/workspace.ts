import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { getGlobalFlags, type CliAuth } from "../settings/cli";

import { errToStr, createWorkspaceIdentifier } from "./api-helper";

import type { Api } from "coder/site/src/api/api";
import type {
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

import type { FeatureSet } from "../featureSet";
import type { UnidirectionalStream } from "../websocket/eventStreamConnection";

import type { CoderApi } from "./coderApi";

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

interface CliContext {
	restClient: Api;
	auth: CliAuth;
	binPath: string;
	workspace: Workspace;
	write: (data: string) => void;
	featureSet: FeatureSet;
}

/** Streams CLI output via `ctx.write`; rejects with stderr on non-zero exit. */
function runCliCommand(ctx: CliContext, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const fullArgs = [
			...getGlobalFlags(vscode.workspace.getConfiguration(), ctx.auth),
			...args,
			createWorkspaceIdentifier(ctx.workspace),
		];
		const proc = spawn(ctx.binPath, fullArgs);
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

	const args = ["start", "--yes"];
	if (ctx.featureSet.buildReason) {
		args.push("--reason", "vscode_connection");
	}

	await runCliCommand(ctx, args);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Update a workspace to the latest template version. Callers must collect
 * any newly-required parameters via `collectUpdateParameters` first; this
 * function does not prompt. Falls back to the REST API on CLIs older than
 * 2.24.
 */
export async function updateWorkspace(
	ctx: CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	if (!ctx.featureSet.cliUpdate) {
		return updateWorkspaceViaApi(ctx, parameters);
	}

	const paramArgs = parameters.flatMap((p) => [
		"--parameter",
		`${p.name}=${p.value}`,
	]);
	await runCliCommand(ctx, ["update", ...paramArgs]);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

async function updateWorkspaceViaApi(
	ctx: CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	if (ctx.workspace.latest_build.status === "running") {
		ctx.write("Stopping workspace for update...\r\n");
		const stopBuild = await ctx.restClient.stopWorkspace(ctx.workspace.id);
		const stoppedJob = await ctx.restClient.waitForBuild(stopBuild);
		if (stoppedJob?.status === "canceled") {
			throw new Error("Workspace update cancelled during stop");
		}
	}

	ctx.write("Starting workspace with updated template...\r\n");
	const template = await ctx.restClient.getTemplate(ctx.workspace.template_id);
	await ctx.restClient.startWorkspace(
		ctx.workspace.id,
		template.active_version_id,
		undefined,
		parameters,
	);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Streams build logs in real-time via a callback.
 * Returns the websocket for lifecycle management.
 */
export async function streamBuildLogs(
	client: CoderApi,
	onOutput: (line: string) => void,
	buildId: string,
): Promise<UnidirectionalStream<ProvisionerJobLog>> {
	const socket = await client.watchBuildLogsByBuildId(buildId, []);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			onOutput(errToStr(data.parseError, "Failed to parse message"));
		} else {
			onOutput(data.parsedMessage.output);
		}
	});

	socket.addEventListener("error", (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching workspace build logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	socket.addEventListener("close", () => {
		onOutput("Build complete");
	});

	return socket;
}

/**
 * Streams agent logs in real-time via a callback.
 * Returns the websocket for lifecycle management.
 */
export async function streamAgentLogs(
	client: CoderApi,
	onOutput: (line: string) => void,
	agentId: string,
): Promise<UnidirectionalStream<WorkspaceAgentLog[]>> {
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

	socket.addEventListener("error", (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching agent logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	return socket;
}
