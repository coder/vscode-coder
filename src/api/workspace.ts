import { type Api } from "coder/site/src/api/api";
import {
	type WorkspaceAgentLog,
	type ProvisionerJobLog,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { getGlobalFlags } from "../cliConfig";
import { type FeatureSet } from "../featureSet";
import { escapeCommandArg } from "../util";
import { type UnidirectionalStream } from "../websocket/eventStreamConnection";

import { errToStr, createWorkspaceIdentifier } from "./api-helper";
import { type CoderApi } from "./coderApi";

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
 * Streams build logs to the emitter in real-time.
 * Returns the websocket for lifecycle management.
 */
export async function streamBuildLogs(
	client: CoderApi,
	writeEmitter: vscode.EventEmitter<string>,
	workspace: Workspace,
): Promise<UnidirectionalStream<ProvisionerJobLog>> {
	const socket = await client.watchBuildLogsByBuildId(
		workspace.latest_build.id,
		[],
	);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			writeEmitter.fire(
				errToStr(data.parseError, "Failed to parse message") + "\r\n",
			);
		} else {
			writeEmitter.fire(data.parsedMessage.output + "\r\n");
		}
	});

	socket.addEventListener("error", (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		writeEmitter.fire(
			`Error watching workspace build logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}\r\n`,
		);
	});

	socket.addEventListener("close", () => {
		writeEmitter.fire("Build complete\r\n");
	});

	return socket;
}

/**
 * Streams agent logs to the emitter in real-time.
 * Returns the websocket for lifecycle management.
 */
export async function streamAgentLogs(
	client: CoderApi,
	writeEmitter: vscode.EventEmitter<string>,
	agent: WorkspaceAgent,
): Promise<UnidirectionalStream<WorkspaceAgentLog[]>> {
	const socket = await client.watchWorkspaceAgentLogs(agent.id, []);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			writeEmitter.fire(
				errToStr(data.parseError, "Failed to parse message") + "\r\n",
			);
		} else {
			for (const log of data.parsedMessage) {
				writeEmitter.fire(log.output + "\r\n");
			}
		}
	});

	socket.addEventListener("error", (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		writeEmitter.fire(
			`Error watching agent logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}\r\n`,
		);
	});

	return socket;
}
