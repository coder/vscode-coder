import { type Api } from "coder/site/src/api/api";
import {
	type WorkspaceAgentLog,
	type ProvisionerJobLog,
	type Workspace,
} from "coder/site/src/api/typesGenerated";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { type CliAuth, getGlobalFlags } from "../cliConfig";
import { type FeatureSet } from "../featureSet";
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

/**
 * Start or update a workspace and return the updated workspace.
 */
export async function startWorkspaceIfStoppedOrFailed(
	restClient: Api,
	auth: CliAuth,
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
			...getGlobalFlags(vscode.workspace.getConfiguration(), auth),
			"start",
			"--yes",
			createWorkspaceIdentifier(workspace),
		];
		if (featureSet.buildReason) {
			startArgs.push("--reason", "vscode_connection");
		}

		// { shell: true } requires one shell-safe command string, otherwise we lose all escaping
		const cmd = `${escapeCommandArg(binPath)} ${startArgs.join(" ")}`;
		const startProcess = spawn(cmd, { shell: true });

		startProcess.stdout.on("data", (data: Buffer) => {
			const lines = data
				.toString()
				.split(/\r*\n/)
				.filter((line) => line !== "");
			for (const line of lines) {
				writeEmitter.fire(line.toString() + "\r\n");
			}
		});

		let capturedStderr = "";
		startProcess.stderr.on("data", (data: Buffer) => {
			const lines = data
				.toString()
				.split(/\r*\n/)
				.filter((line) => line !== "");
			for (const line of lines) {
				writeEmitter.fire(line.toString() + "\r\n");
				capturedStderr += line.toString() + "\n";
			}
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
