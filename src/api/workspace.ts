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
 * Parameter values that need user input are collected with VS Code prompts
 * before the workspace is stopped.
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
	const buildParameters = await promptForUpdateParameters(
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

async function promptForUpdateParameters(
	oldBuildParameters: WorkspaceBuildParameter[],
	templateParameters: TemplateVersionParameter[],
): Promise<WorkspaceBuildParameter[]> {
	const missingParameters = getMissingParameters(
		oldBuildParameters,
		[],
		templateParameters,
	);
	const buildParameters: WorkspaceBuildParameter[] = [];

	for (const parameter of missingParameters) {
		const value = await promptForParameter(parameter);
		if (value === undefined) {
			throw new Error("Workspace update canceled while configuring parameters");
		}
		buildParameters.push({ name: parameter.name, value });
	}

	return buildParameters;
}

function getMissingParameters(
	oldBuildParameters: WorkspaceBuildParameter[],
	buildParameters: WorkspaceBuildParameter[],
	templateParameters: TemplateVersionParameter[],
): TemplateVersionParameter[] {
	const missingParameters: TemplateVersionParameter[] = [];
	const requiredParameters = templateParameters.filter(
		(parameter) =>
			(parameter.mutable && parameter.required) || !parameter.mutable,
	);

	for (const parameter of requiredParameters) {
		const buildParameter = findBuildParameter(
			parameter,
			oldBuildParameters,
			buildParameters,
		);
		if (!buildParameter) {
			missingParameters.push(parameter);
		}
	}

	for (const parameter of templateParameters) {
		if (
			parameter.options.length === 0 ||
			parameter.form_type === "multi-select"
		) {
			continue;
		}

		const buildParameter = findBuildParameter(
			parameter,
			oldBuildParameters,
			buildParameters,
		);
		if (!buildParameter) {
			continue;
		}

		const matchingOption = parameter.options.find(
			(option) => option.value === buildParameter.value,
		);
		if (!matchingOption && !missingParameters.includes(parameter)) {
			missingParameters.push(parameter);
		}
	}

	return missingParameters;
}

function findBuildParameter(
	parameter: TemplateVersionParameter,
	oldBuildParameters: WorkspaceBuildParameter[],
	buildParameters: WorkspaceBuildParameter[],
): WorkspaceBuildParameter | undefined {
	return (
		buildParameters.find((p) => p.name === parameter.name) ??
		oldBuildParameters.find((p) => p.name === parameter.name)
	);
}

async function promptForParameter(
	parameter: TemplateVersionParameter,
): Promise<string | undefined> {
	if (parameter.options.length > 0) {
		if (
			parameter.form_type === "multi-select" ||
			parameter.type === "list(string)"
		) {
			return promptForMultiSelectParameter(parameter);
		}
		return promptForSelectParameter(parameter);
	}

	if (parameter.type === "bool" || parameter.form_type === "checkbox") {
		return promptForBooleanParameter(parameter);
	}

	return promptForTextParameter(parameter);
}

type ParameterQuickPickItem = vscode.QuickPickItem & {
	value: string;
};

async function promptForSelectParameter(
	parameter: TemplateVersionParameter,
): Promise<string | undefined> {
	const items = parameter.options.map((option): ParameterQuickPickItem => {
		const details = [option.description];
		if (option.value === parameter.default_value) {
			details.push("Default");
		}
		return {
			label: option.name || option.value,
			description: option.value,
			detail: details.filter(Boolean).join(" • "),
			value: option.value,
		};
	});
	const choice = await vscode.window.showQuickPick(items, {
		title: parameterTitle(parameter),
		placeHolder: parameterPlaceHolder(parameter),
		ignoreFocusOut: true,
	});
	return choice?.value;
}

async function promptForMultiSelectParameter(
	parameter: TemplateVersionParameter,
): Promise<string | undefined> {
	const defaultValues = parseListParameterValue(parameter.default_value);
	const items = parameter.options.map(
		(option): ParameterQuickPickItem => ({
			label: option.name || option.value,
			description: option.value,
			detail: option.description,
			picked: defaultValues.includes(option.value),
			value: option.value,
		}),
	);
	const choices = await vscode.window.showQuickPick(items, {
		title: parameterTitle(parameter),
		placeHolder: parameterPlaceHolder(parameter),
		canPickMany: true,
		ignoreFocusOut: true,
	});
	return choices
		? JSON.stringify(choices.map((choice) => choice.value))
		: undefined;
}

async function promptForBooleanParameter(
	parameter: TemplateVersionParameter,
): Promise<string | undefined> {
	const items: ParameterQuickPickItem[] = [
		{ label: "Yes", value: "true" },
		{ label: "No", value: "false" },
	].map((item) => ({
		...item,
		detail: item.value === parameter.default_value ? "Default" : undefined,
	}));
	const choice = await vscode.window.showQuickPick(items, {
		title: parameterTitle(parameter),
		placeHolder: parameterPlaceHolder(parameter),
		ignoreFocusOut: true,
	});
	return choice?.value;
}

async function promptForTextParameter(
	parameter: TemplateVersionParameter,
): Promise<string | undefined> {
	return vscode.window.showInputBox({
		title: parameterTitle(parameter),
		prompt: parameterPlaceHolder(parameter),
		value: parameter.default_value,
		password: parameter.form_type === "password",
		ignoreFocusOut: true,
		validateInput: (value) => validateParameterInput(parameter, value),
	});
}

function validateParameterInput(
	parameter: TemplateVersionParameter,
	value: string,
): string | undefined {
	if (parameter.required && value === "") {
		return "A value is required.";
	}

	if (parameter.type === "number") {
		const numberValue = Number(value);
		if (!Number.isFinite(numberValue)) {
			return "Enter a number.";
		}
		if (
			parameter.validation_min !== undefined &&
			numberValue < parameter.validation_min
		) {
			return `Enter a number greater than or equal to ${parameter.validation_min}.`;
		}
		if (
			parameter.validation_max !== undefined &&
			numberValue > parameter.validation_max
		) {
			return `Enter a number less than or equal to ${parameter.validation_max}.`;
		}
	}

	if (parameter.type === "list(string)" && parameter.options.length === 0) {
		const values = parseListParameterValue(value);
		if (values.length === 0 && value !== "[]") {
			return "Enter a JSON array of strings.";
		}
	}

	if (parameter.validation_regex) {
		const regex = new RegExp(parameter.validation_regex);
		if (!regex.test(value)) {
			return parameter.validation_error || "Enter a valid value.";
		}
	}

	return undefined;
}

function parseListParameterValue(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) &&
			parsed.every((item): item is string => typeof item === "string")
			? parsed
			: [];
	} catch {
		return [];
	}
}

function parameterTitle(parameter: TemplateVersionParameter): string {
	return `Workspace parameter: ${parameterDisplayName(parameter)}`;
}

function parameterPlaceHolder(parameter: TemplateVersionParameter): string {
	return (
		parameter.description_plaintext || parameter.description || parameter.name
	);
}

function parameterDisplayName(parameter: TemplateVersionParameter): string {
	return parameter.display_name || parameter.name;
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
