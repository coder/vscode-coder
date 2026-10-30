import { spawn } from "node:child_process";
import * as vscode from "vscode";

import { errToStr } from "../error/normalize";
import {
	getCliProcessEnv,
	getGlobalFlags,
	type CliAuth,
} from "../settings/cli";

import { createWorkspaceIdentifier } from "./models";
import { WorkspaceUpdateCancelledError } from "./updateParameters";

import type {
	CreateWorkspaceBuildOnSuccessRequest,
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
	WorkspaceBuildParameter,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { CliFeatureSet, ServerFeatureSet } from "../featureSet";
import type { UnidirectionalStream } from "../websocket/eventStreamConnection";

import type { CoderApi } from "./coderApi";

const BUILD_REASON = "vscode_connection";

const STARTABLE_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"stopped",
	"failed",
	"canceled",
]);

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

type BuildApi = Pick<
	CoderApi,
	| "getWorkspace"
	| "postWorkspaceBuild"
	| "startWorkspace"
	| "stopWorkspace"
	| "waitForBuild"
>;

interface WorkspaceContext {
	restClient: BuildApi;
	workspace: Workspace;
	write: (data: string) => void;
	serverFeatures: ServerFeatureSet;
	/** Reject work after its initiating session changes. */
	check?: () => void;
}

interface CliContext extends WorkspaceContext {
	auth: CliAuth;
	binPath: string;
	cliFeatures: CliFeatureSet;
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
		ctx.check?.();
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
 * Start a stopped, failed or canceled workspace using `coder start`.
 * No-ops if the workspace is already running.
 */
export async function startWorkspace(ctx: CliContext): Promise<Workspace> {
	if (!STARTABLE_STATUSES.has(ctx.workspace.latest_build.status)) {
		return ctx.workspace;
	}

	const args = ["start", "--yes"];
	if (ctx.cliFeatures.buildReason) {
		args.push("--reason", BUILD_REASON);
	}

	await runCliCommand(ctx, args);
	ctx.check?.();
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Update a workspace to the latest template version. Callers must collect
 * any newly-required parameters via `collectUpdateParameters` first; this
 * function does not prompt. On servers before 2.36, updating takes two
 * builds: `coder update`, or the REST API on CLIs before 2.24.
 */
export async function updateWorkspace(
	ctx: WorkspaceContext | CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	if (ctx.serverFeatures.onSuccessBuild) {
		return updateWorkspaceInOneBuild(ctx, parameters);
	}
	if (!("cliFeatures" in ctx) || !ctx.cliFeatures.cliUpdate) {
		return updateWorkspaceViaApi(ctx, parameters);
	}

	const paramArgs = parameters.flatMap((p) => [
		"--parameter",
		`${p.name}=${p.value}`,
	]);
	await runCliCommand(ctx, ["update", ...paramArgs]);
	ctx.check?.();
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Stop and start in one build, so nothing can take the slot in between. The
 * returned workspace carries the stop build; the server starts it after.
 */
async function updateWorkspaceInOneBuild(
	ctx: WorkspaceContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	// The build may have changed while parameters were collected.
	ctx.check?.();
	const workspace = await ctx.restClient.getWorkspace(ctx.workspace.id);
	ctx.check?.();
	assertSameUpdate(ctx.workspace, workspace);
	const running = workspace.latest_build.status === "running";
	const start: CreateWorkspaceBuildOnSuccessRequest = {
		transition: "start",
		rich_parameter_values: parameters,
	};

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

/** The update no longer does what was confirmed, so it must be confirmed again. */
export function updateChangedError(
	workspaceName: string,
): WorkspaceUpdateCancelledError {
	return new WorkspaceUpdateCancelledError(
		`${workspaceName} changed while preparing its update. Run Update again to confirm the current operation.`,
	);
}

/**
 * Rejects an update of `current` that would no longer do what was confirmed
 * for `confirmed`: the same start or restart, to the same version.
 * `label` preserves the original selection's name in a refusal.
 */
export function assertSameUpdate(
	confirmed: Workspace,
	current: Workspace,
	label?: string,
): void {
	const running = current.latest_build.status === "running";
	if (
		running !== (confirmed.latest_build.status === "running") ||
		(!running && !STARTABLE_STATUSES.has(current.latest_build.status)) ||
		current.template_active_version_id !== confirmed.template_active_version_id
	) {
		throw updateChangedError(label ?? createWorkspaceIdentifier(current));
	}
}

async function updateWorkspaceViaApi(
	ctx: WorkspaceContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	ctx.check?.();
	const running = ctx.workspace.latest_build.status === "running";
	let expectedBuildId = ctx.workspace.latest_build.id;
	if (running) {
		ctx.write("Stopping workspace for update...\r\n");
		const stopBuild = await ctx.restClient.stopWorkspace(ctx.workspace.id);
		expectedBuildId = stopBuild.id;
		const stoppedJob = await ctx.restClient.waitForBuild(stopBuild, {
			check: ctx.check,
		});
		ctx.check?.();
		if (stoppedJob?.status !== "succeeded") {
			throw new Error("Workspace update stop build did not succeed");
		}
	}

	const latest = await ctx.restClient.getWorkspace(ctx.workspace.id);
	ctx.check?.();
	if (
		latest.latest_build.id !== expectedBuildId ||
		(running && latest.latest_build.status !== "stopped") ||
		!STARTABLE_STATUSES.has(latest.latest_build.status) ||
		latest.template_active_version_id !==
			ctx.workspace.template_active_version_id
	) {
		throw updateChangedError(createWorkspaceIdentifier(latest));
	}
	ctx.write("Starting workspace with updated template...\r\n");
	await ctx.restClient.startWorkspace(
		ctx.workspace.id,
		ctx.workspace.template_active_version_id,
		undefined,
		parameters,
	);
	ctx.check?.();
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/** Restart on the last build's version, without overwriting an intervening build. */
export async function restartWorkspace(
	restClient: Pick<
		BuildApi,
		"postWorkspaceBuild" | "waitForBuild" | "getWorkspace"
	>,
	workspace: Workspace,
	check?: () => void,
): Promise<void> {
	const workspaceId = createWorkspaceIdentifier(workspace);
	const versionId = workspace.latest_build.template_version_id;
	check?.();
	const stopBuild = await restClient.postWorkspaceBuild(workspace.id, {
		transition: "stop",
	});
	const stopped = await restClient.waitForBuild(stopBuild, {
		check,
		retryTransientErrors: true,
	});
	check?.();
	if (stopped?.status !== "succeeded") {
		throw new Error(
			`Failed to stop ${workspaceId}, so it was not started again`,
		);
	}
	const latest = await restClient.getWorkspace(workspace.id);
	check?.();
	if (
		latest.latest_build.id !== stopBuild.id ||
		latest.latest_build.status !== "stopped"
	) {
		throw new Error(
			`${workspaceId} changed after stopping. Restart was halted to avoid overwriting another operation.`,
		);
	}
	try {
		await restClient.postWorkspaceBuild(workspace.id, {
			transition: "start",
			template_version_id: versionId,
		});
	} catch (error) {
		check?.();
		throw new Error(
			`The stop completed for ${workspaceId}, but its start request failed: ${errToStr(error)}. Check its status before retrying.`,
			{ cause: error },
		);
	}
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
