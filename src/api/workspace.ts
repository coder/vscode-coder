import { type Api } from "coder/site/src/api/api";
import {
	type WorkspaceAgentLog,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { type FeatureSet } from "../featureSet";
import { getGlobalFlags } from "../globalFlags";
import { escapeCommandArg } from "../util";
import { type OneWayWebSocket } from "../websocket/oneWayWebSocket";

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
 * Wait for the latest build to finish while streaming logs to the emitter.
 *
 * Once completed, fetch the workspace again and return it.
 */
export async function waitForBuild(
	client: CoderApi,
	writeEmitter: vscode.EventEmitter<string>,
	workspace: Workspace,
): Promise<Workspace> {
	const socket = await client.watchBuildLogsByBuildId(
		workspace.latest_build.id,
		[],
	);

	await new Promise<void>((resolve, reject) => {
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
			return reject(
				new Error(
					`Failed to watch workspace build on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
				),
			);
		});

		socket.addEventListener("close", () => resolve());
	});

	writeEmitter.fire("Build complete\r\n");
	const updatedWorkspace = await client.getWorkspace(workspace.id);
	writeEmitter.fire(
		`Workspace is now ${updatedWorkspace.latest_build.status}\r\n`,
	);
	return updatedWorkspace;
}

/**
 * Streams agent logs to the emitter in real-time.
 * Returns the websocket and a completion promise that rejects on error.
 */
export async function streamAgentLogs(
	client: CoderApi,
	writeEmitter: vscode.EventEmitter<string>,
	agent: WorkspaceAgent,
): Promise<{
	socket: OneWayWebSocket<WorkspaceAgentLog[]>;
	completion: Promise<void>;
}> {
	const socket = await client.watchWorkspaceAgentLogs(agent.id, []);

	const completion = new Promise<void>((resolve, reject) => {
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
			return reject(
				new Error(
					`Failed to watch agent logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
				),
			);
		});

		socket.addEventListener("close", () => resolve());
	});

	return { socket, completion };
}
