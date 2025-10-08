import { spawn } from "child_process";
import { type Api } from "coder/site/src/api/api";
import { type Workspace } from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";

import { type FeatureSet } from "../featureSet";
import { getGlobalFlags } from "../globalFlags";
import { escapeCommandArg } from "../util";

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
			startArgs.push(...["--reason", "vscode_connection"]);
		}

		// { shell: true } requires one shell-safe command string, otherwise we lose all escaping
		const cmd = `${escapeCommandArg(binPath)} ${startArgs.join(" ")}`;
		const startProcess = spawn(cmd, { shell: true });

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
	client: CoderApi,
	writeEmitter: vscode.EventEmitter<string>,
	workspace: Workspace,
): Promise<Workspace> {
	// This fetches the initial bunch of logs.
	const logs = await client.getWorkspaceBuildLogs(workspace.latest_build.id);
	logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"));

	const socket = await client.watchBuildLogsByBuildId(
		workspace.latest_build.id,
		logs,
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
