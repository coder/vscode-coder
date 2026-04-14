import { type Api } from "coder/site/src/api/api";
import {
	type WorkspaceAgentLog,
	type ProvisionerJobLog,
	type Workspace,
} from "coder/site/src/api/typesGenerated";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { type FeatureSet } from "../featureSet";
import { getGlobalShellFlags, type CliAuth } from "../settings/cli";
import { escapeCommandArg } from "../util";
import { type UnidirectionalStream } from "../websocket/eventStreamConnection";

import { errToStr, createWorkspaceIdentifier } from "./api-helper";
import { type CoderApi } from "./coderApi";

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
	auth: CliAuth;
	binPath: string;
	workspace: Workspace;
	writeEmitter: vscode.EventEmitter<string>;
}

/**
 * Spawn a Coder CLI subcommand and stream its output.
 * Resolves when the process exits successfully; rejects on non-zero exit.
 */
function runCliCommand(ctx: CliContext, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const fullArgs = [
			...getGlobalShellFlags(vscode.workspace.getConfiguration(), ctx.auth),
			...args,
			createWorkspaceIdentifier(ctx.workspace),
		];

		const cmd = `${escapeCommandArg(ctx.binPath)} ${fullArgs.join(" ")}`;
		const proc = spawn(cmd, { shell: true });

		proc.stdout.on("data", (data: Buffer) => {
			for (const line of splitLines(data)) {
				ctx.writeEmitter.fire(line + "\r\n");
			}
		});

		let capturedStderr = "";
		proc.stderr.on("data", (data: Buffer) => {
			for (const line of splitLines(data)) {
				ctx.writeEmitter.fire(line + "\r\n");
				capturedStderr += line + "\n";
			}
		});

		proc.on("close", (code: number) => {
			if (code === 0) {
				resolve();
			} else {
				let errorText = `"${fullArgs.join(" ")}" exited with code ${code}`;
				if (capturedStderr !== "") {
					errorText += `: ${capturedStderr}`;
				}
				reject(new Error(errorText));
			}
		});
	});
}

function splitLines(data: Buffer): string[] {
	return data
		.toString()
		.split(/\r*\n/)
		.filter((line) => line !== "");
}

/**
 * Start a stopped or failed workspace using `coder start`.
 * No-ops if the workspace is already running.
 */
export async function startWorkspace(
	restClient: Api,
	ctx: CliContext,
	featureSet: FeatureSet,
): Promise<Workspace> {
	const current = await restClient.getWorkspace(ctx.workspace.id);
	if (!["stopped", "failed"].includes(current.latest_build.status)) {
		return current;
	}

	const args = ["start", "--yes"];
	if (featureSet.buildReason) {
		args.push("--reason", "vscode_connection");
	}

	await runCliCommand(ctx, args);
	return restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Update a workspace to the latest template version.
 *
 * Uses `coder update` when the CLI supports it (>= 2.25).
 * Falls back to the REST API: stop → wait → updateWorkspaceVersion.
 */
export async function updateWorkspace(
	restClient: Api,
	ctx: CliContext,
	featureSet: FeatureSet,
): Promise<Workspace> {
	if (featureSet.cliUpdate) {
		await runCliCommand(ctx, ["update"]);
		return restClient.getWorkspace(ctx.workspace.id);
	}

	// REST API fallback for older CLIs.
	const workspace = await restClient.getWorkspace(ctx.workspace.id);
	if (workspace.latest_build.status === "running") {
		ctx.writeEmitter.fire("Stopping workspace for update...\r\n");
		const stopBuild = await restClient.stopWorkspace(workspace.id);
		const stoppedJob = await restClient.waitForBuild(stopBuild);
		if (stoppedJob?.status === "canceled") {
			throw new Error("Workspace update canceled during stop");
		}
	}

	ctx.writeEmitter.fire("Starting workspace with updated template...\r\n");
	await restClient.updateWorkspaceVersion(workspace);
	return restClient.getWorkspace(ctx.workspace.id);
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
