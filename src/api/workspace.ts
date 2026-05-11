import { type Api } from "coder/site/src/api/api";
import {
	type ProvisionerJobLog,
	type TemplateVersionParameter,
	type Workspace,
	type WorkspaceAgentLog,
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
			ctx.write(data.toString());
		});

		let capturedStderr = "";
		proc.stderr.on("data", (data: Buffer) => {
			const text = data.toString();
			ctx.write(text);
			capturedStderr += text;
		});

		proc.on("close", (code: number) => {
			if (code === 0) {
				resolve();
			} else {
				let msg = `"${fullArgs.join(" ")}" exited with code ${code}`;
				if (capturedStderr) msg += `: ${capturedStderr}`;
				reject(new Error(msg));
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
 * Update a workspace to the latest template version. Collects any newly-
 * required parameters via VS Code prompts and passes them to the CLI as flags
 * (the resolver phase can't render an interactive terminal). Falls back to
 * the REST API for CLIs older than 2.24.
 */
export async function updateWorkspace(ctx: CliContext): Promise<Workspace> {
	if (!ctx.featureSet.cliUpdate) {
		return updateWorkspaceVersion(ctx);
	}

	const paramArgs = await collectUpdateParameters(ctx);
	await runCliCommand(ctx, ["update", ...paramArgs]);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

async function updateWorkspaceVersion(ctx: CliContext): Promise<Workspace> {
	if (ctx.workspace.latest_build.status === "running") {
		ctx.write("Stopping workspace for update...\r\n");
		const stopBuild = await ctx.restClient.stopWorkspace(ctx.workspace.id);
		const stoppedJob = await ctx.restClient.waitForBuild(stopBuild);
		if (stoppedJob?.status === "canceled") {
			throw new Error("Workspace update canceled during stop");
		}
	}

	ctx.write("Starting workspace with updated template...\r\n");
	await ctx.restClient.updateWorkspaceVersion(ctx.workspace);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

async function collectUpdateParameters(ctx: CliContext): Promise<string[]> {
	const newParams = await ctx.restClient.getTemplateVersionRichParameters(
		ctx.workspace.template_active_version_id,
	);
	const candidates = newParams.filter((p) => p.required && !p.default_value);
	if (candidates.length === 0) return [];

	const currentValues = await ctx.restClient.getWorkspaceBuildParameters(
		ctx.workspace.latest_build.id,
	);
	const existing = new Set(currentValues.map((p) => p.name));
	const toPrompt = candidates.filter((p) => !existing.has(p.name));

	const args: string[] = [];
	for (let i = 0; i < toPrompt.length; i++) {
		const value = await promptForParameter(toPrompt[i], i + 1, toPrompt.length);
		if (value === undefined) {
			throw new Error("Workspace update cancelled");
		}
		args.push("--parameter", escapeCommandArg(`${toPrompt[i].name}=${value}`));
	}
	return args;
}

function promptForParameter(
	param: TemplateVersionParameter,
	step: number,
	totalSteps: number,
): Promise<string | undefined> {
	const title = param.display_name || param.name;
	const items = quickPickItems(param);

	if (items) {
		const multi = param.form_type === "multi-select";
		const qp = vscode.window.createQuickPick<(typeof items)[number]>();
		qp.title = title;
		qp.step = step;
		qp.totalSteps = totalSteps;
		qp.placeholder = param.description_plaintext;
		qp.items = items;
		qp.canSelectMany = multi;
		qp.ignoreFocusOut = true;
		return untilHidden(qp, () => {
			if (multi) {
				return qp.selectedItems.length > 0
					? JSON.stringify(qp.selectedItems.map((i) => i.value))
					: undefined;
			}
			return qp.selectedItems[0]?.value;
		});
	}

	const input = vscode.window.createInputBox();
	input.title = title;
	input.step = step;
	input.totalSteps = totalSteps;
	input.prompt = param.description_plaintext;
	input.placeholder = formatConstraint(param);
	input.value = param.default_value;
	input.ignoreFocusOut = true;
	const validate = makeValidator(param);
	const refresh = () => {
		input.validationMessage = validate(input.value).message ?? "";
	};
	refresh();
	input.onDidChangeValue(refresh);
	return untilHidden(input, () =>
		validate(input.value).ok ? input.value : undefined,
	);
}

function untilHidden<T>(
	qi: vscode.InputBox | vscode.QuickPick<vscode.QuickPickItem>,
	onAccept: () => T | undefined,
): Promise<T | undefined> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: T | undefined) => {
			if (done) return;
			done = true;
			resolve(value);
			qi.dispose();
		};
		qi.onDidAccept(() => {
			const value = onAccept();
			if (value !== undefined) finish(value);
		});
		qi.onDidHide(() => finish(undefined));
		qi.show();
	});
}

/**
 * Returns picker items if the param needs a chooser, otherwise undefined.
 * Anything that falls through gets a free-form text input.
 */
function quickPickItems(
	param: TemplateVersionParameter,
): Array<vscode.QuickPickItem & { value: string }> | undefined {
	if (param.type === "bool") {
		return [
			{ label: "True", value: "true" },
			{ label: "False", value: "false" },
		];
	}
	if (param.options.length > 0) {
		return param.options.map((o) => ({
			label: o.name,
			description: o.description,
			value: o.value,
		}));
	}
	return undefined;
}

function formatConstraint(param: TemplateVersionParameter): string {
	if (param.type === "number") {
		const lo = param.validation_min;
		const hi = param.validation_max;
		if (lo !== undefined && hi !== undefined) return `between ${lo} and ${hi}`;
		if (lo !== undefined) return `at least ${lo}`;
		if (hi !== undefined) return `at most ${hi}`;
		return "a number";
	}
	if (param.validation_regex) {
		return param.validation_error || `must match ${param.validation_regex}`;
	}
	return "";
}

/**
 * Returns `{ ok, message }`: `ok` gates submission, `message` (if any) is
 * shown inline. Empty input on a required param blocks submit silently.
 * Coder regexes are RE2; on parse failure we defer to server-side validation.
 */
function makeValidator(
	param: TemplateVersionParameter,
): (input: string) => { ok: boolean; message?: string } {
	let re: RegExp | undefined;
	if (param.validation_regex) {
		try {
			re = new RegExp(param.validation_regex);
		} catch {
			re = undefined;
		}
	}
	return (input) => {
		if (!input) return { ok: !param.required };
		if (param.type === "number") {
			const n = Number(input);
			if (!Number.isFinite(n)) {
				return { ok: false, message: "Must be a number" };
			}
			if (param.validation_min !== undefined && n < param.validation_min) {
				return {
					ok: false,
					message: `Must be at least ${param.validation_min}`,
				};
			}
			if (param.validation_max !== undefined && n > param.validation_max) {
				return {
					ok: false,
					message: `Must be at most ${param.validation_max}`,
				};
			}
		}
		if (re && !re.test(input)) {
			return { ok: false, message: param.validation_error || "Invalid format" };
		}
		return { ok: true };
	};
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
