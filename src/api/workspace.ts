import { type Api } from "coder/site/src/api/api";
import {
	type CreateWorkspaceBuildRequest,
	type ProvisionerJobLog,
	type TemplateVersionParameter,
	type Workspace,
	type WorkspaceAgentLog,
	type WorkspaceBuildParameter,
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
	restClient: Api;
	auth: CliAuth;
	binPath: string;
	workspace: Workspace;
	write: (data: string) => void;
	featureSet: FeatureSet;
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
			ctx.write(data.toString().replace(/\r?\n/g, "\r\n"));
		});

		let capturedStderr = "";
		proc.stderr.on("data", (data: Buffer) => {
			const text = data.toString();
			ctx.write(text.replace(/\r?\n/g, "\r\n"));
			capturedStderr += text;
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
 * Update a workspace to the latest template version using the API.
 *
 * Parameter prompts cannot be answered from the read-only output channel, so
 * update builds are created with existing mutable values where valid and
 * template defaults for values that would otherwise require prompting.
 */
export async function updateWorkspace(ctx: CliContext): Promise<Workspace> {
	const workspace = await ctx.restClient.getWorkspace(ctx.workspace.id);
	if (!workspace.outdated) {
		ctx.write("Workspace is up-to-date.\r\n");
		return workspace;
	}

	const targetVersionId = workspace.template_active_version_id;
	const oldBuildParameters = await ctx.restClient.getWorkspaceBuildParameters(
		workspace.latest_build.id,
	);
	const templateParameters = await getUpdateTemplateParameters(
		ctx,
		workspace,
		oldBuildParameters,
		targetVersionId,
	);
	const buildParameters = resolveUpdateParametersWithDefaults(
		oldBuildParameters,
		templateParameters,
	);

	if (workspace.latest_build.transition === "start") {
		ctx.write("Stopping workspace for update...\r\n");
		const stopBuild = await ctx.restClient.postWorkspaceBuild(
			workspace.id,
			withBuildReason(ctx, { transition: "stop" }),
		);
		const stoppedJob = await ctx.restClient.waitForBuild(stopBuild);
		if (stoppedJob?.status === "canceled") {
			throw new Error("Workspace update canceled during stop");
		}
	}

	ctx.write("Starting workspace with updated template...\r\n");
	const startBuild = await ctx.restClient.postWorkspaceBuild(
		workspace.id,
		withBuildReason(ctx, {
			transition: "start",
			template_version_id: targetVersionId,
			rich_parameter_values: buildParameters,
		}),
	);
	const startedJob = await ctx.restClient.waitForBuild(startBuild);
	if (startedJob?.status === "canceled") {
		throw new Error("Workspace update canceled during start");
	}

	return ctx.restClient.getWorkspace(workspace.id);
}

async function getUpdateTemplateParameters(
	ctx: CliContext,
	workspace: Workspace,
	oldBuildParameters: WorkspaceBuildParameter[],
	targetVersionId: string,
): Promise<TemplateVersionParameter[]> {
	if (workspace.template_use_classic_parameter_flow) {
		return ctx.restClient.getTemplateVersionRichParameters(targetVersionId);
	}

	return ctx.restClient.getDynamicParameters(
		targetVersionId,
		workspace.owner_id,
		oldBuildParameters,
	);
}

function withBuildReason(
	ctx: CliContext,
	request: CreateWorkspaceBuildRequest,
): CreateWorkspaceBuildRequest {
	if (!ctx.featureSet.buildReason) {
		return request;
	}
	return { ...request, reason: "vscode_connection" };
}

function resolveUpdateParametersWithDefaults(
	oldBuildParameters: WorkspaceBuildParameter[],
	templateParameters: TemplateVersionParameter[],
): WorkspaceBuildParameter[] {
	const oldBuildParametersByName = new Map(
		oldBuildParameters.map((parameter) => [parameter.name, parameter]),
	);
	const resolvedParameters: WorkspaceBuildParameter[] = [];

	for (const parameter of templateParameters) {
		if (parameter.ephemeral) {
			continue;
		}

		const oldParameter = oldBuildParametersByName.get(parameter.name);
		const oldParameterIsValid = oldParameter
			? isValidParameterValue(oldParameter.value, parameter)
			: false;

		if (oldParameter && parameter.mutable && oldParameterIsValid) {
			resolvedParameters.push(oldParameter);
			continue;
		}

		if (!oldParameter || !oldParameterIsValid || parameter.mutable) {
			if (!hasUsableDefault(parameter)) {
				throw new Error(missingDefaultMessage(parameter));
			}
			resolvedParameters.push({
				name: parameter.name,
				value: parameter.default_value,
			});
		}
	}

	return resolvedParameters;
}

function hasUsableDefault(parameter: TemplateVersionParameter): boolean {
	return !parameter.required;
}

function missingDefaultMessage(parameter: TemplateVersionParameter): string {
	const name = parameter.display_name
		? `${parameter.display_name} (${parameter.name})`
		: parameter.name;
	return `Workspace update requires a value for parameter "${name}", but no default is available. Open Coder in your browser to set this parameter, then try updating again.`;
}

function isValidParameterValue(
	value: string,
	parameter: TemplateVersionParameter,
): boolean {
	if (parameter.options.length === 0) {
		return true;
	}

	const allowedValues = new Set(
		parameter.options.map((option) => option.value),
	);
	if (parameter.type === "list(string)") {
		return isValidListParameterValue(value, allowedValues);
	}

	return allowedValues.has(value);
}

function isValidListParameterValue(
	value: string,
	allowedValues: ReadonlySet<string>,
): boolean {
	let values: unknown;
	try {
		values = JSON.parse(value);
	} catch {
		return false;
	}

	return (
		Array.isArray(values) &&
		values.every(
			(parameterValue) =>
				typeof parameterValue === "string" && allowedValues.has(parameterValue),
		)
	);
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
