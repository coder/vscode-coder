import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import * as vscode from "vscode";

import { throwIfAborted } from "../error/abort";
import { errToStr } from "../error/normalize";
import {
	getCliProcessEnv,
	getGlobalFlags,
	type CliAuth,
} from "../settings/cli";

import { createWorkspaceIdentifier } from "./models";
import { WorkspaceUpdateCancelledError } from "./updateParameters";

import type {
	CreateWorkspaceBuildRequest,
	ProvisionerJobLog,
	Workspace,
	WorkspaceAgentLog,
	WorkspaceBuild,
	WorkspaceBuildParameter,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { ServerFeatureSet } from "../featureSet";
import type {
	EventHandler,
	UnidirectionalStream,
} from "../websocket/eventStreamConnection";
import type { OneWayWebSocket } from "../websocket/oneWayWebSocket";

import type { CoderApi } from "./coderApi";

const BUILD_REASON = "vscode_connection";

/** How long a one-build update waits for the server to queue its start. */
const FOLLOW_UP_POLLS = 30;

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

type BuildClient = Pick<
	CoderApi,
	| "getAxiosInstance"
	| "getWorkspace"
	| "postWorkspaceBuild"
	| "updateWorkspaceDormancy"
	| "waitForBuild"
	| "watchBuildLogsByBuildId"
>;
type BuildRequest = Omit<CreateWorkspaceBuildRequest, "reason">;
export type Write = (line: string) => void;

/** Where builds go, where their logs go, and when to stop. */
export interface BuildContext {
	readonly client: BuildClient;
	readonly write: Write;
	/** Checked before every request, and ends any wait when aborted. */
	readonly signal?: AbortSignal;
}

interface CliContext {
	restClient: Pick<BuildClient, "getWorkspace" | "postWorkspaceBuild">;
	auth: CliAuth;
	binPath: string;
	workspace: Workspace;
	write: Write;
	serverFeatures: ServerFeatureSet;
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
 * Start a stopped or failed workspace using `coder start`.
 * No-ops if the workspace is already running.
 */
export async function startWorkspace(ctx: CliContext): Promise<Workspace> {
	if (!["stopped", "failed"].includes(ctx.workspace.latest_build.status)) {
		return ctx.workspace;
	}

	await runCliCommand(ctx, ["start", "--yes", "--reason", BUILD_REASON]);
	return ctx.restClient.getWorkspace(ctx.workspace.id);
}

/**
 * Update a workspace to the latest template version. Callers must collect
 * any newly-required parameters via `collectUpdateParameters` first; this
 * function does not prompt, and refuses if the workspace changed since. On
 * servers before 2.36, `coder update` takes two builds.
 */
export async function updateWorkspace(
	ctx: CliContext,
	parameters: WorkspaceBuildParameter[],
): Promise<Workspace> {
	const workspace = await rereadForUpdate(ctx.restClient, ctx.workspace);
	if (ctx.serverFeatures.onSuccessBuild) {
		announceUpdate(ctx.write, workspace);
		const build = await postBuild(
			ctx.restClient,
			workspace.id,
			oneBuildUpdate(workspace, parameters),
		);
		// The server starts it after this stop.
		return { ...workspace, latest_build: build };
	}

	const paramArgs = parameters.flatMap((p) => [
		"--parameter",
		`${p.name}=${p.value}`,
	]);
	await runCliCommand({ ...ctx, workspace }, ["update", ...paramArgs]);
	return ctx.restClient.getWorkspace(workspace.id);
}

/**
 * `updateWorkspace` over the REST API, waiting for every build it takes.
 * Before 2.36, a running workspace restarts in two builds.
 */
export async function updateWorkspaceViaApi(
	ctx: BuildContext,
	prepared: Workspace,
	serverFeatures: ServerFeatureSet,
	parameters: WorkspaceBuildParameter[],
): Promise<void> {
	const workspace = await rereadForUpdate(ctx.client, prepared, ctx.signal);
	announceUpdate(ctx.write, workspace);
	if (serverFeatures.onSuccessBuild) {
		await runBuild(ctx, workspace.id, oneBuildUpdate(workspace, parameters));
		return;
	}
	const start = {
		template_version_id: workspace.template_active_version_id,
		rich_parameter_values: parameters,
	};
	await (workspace.latest_build.status === "running"
		? restartWorkspace(ctx, workspace, start)
		: runBuild(ctx, workspace.id, { transition: "start", ...start }));
}

/** Re-reads the workspace and refuses the update if it changed since `prepared`. */
async function rereadForUpdate(
	client: Pick<BuildClient, "getWorkspace">,
	prepared: Workspace,
	signal?: AbortSignal,
): Promise<Workspace> {
	const current = await client.getWorkspace(prepared.id);
	throwIfAborted(signal);
	assertSameUpdate(prepared, current);
	return current;
}

function announceUpdate(write: Write, workspace: Workspace): void {
	const running = workspace.latest_build.status === "running";
	write(
		`${running ? "Restarting" : "Starting"} workspace with the updated template...\r\n`,
	);
}

/**
 * Stop and start in one build, so nothing can take the slot in between. A
 * running workspace gets a stop that the server follows with the start.
 */
function oneBuildUpdate(
	workspace: Workspace,
	parameters: WorkspaceBuildParameter[],
): BuildRequest {
	const start = {
		transition: "start",
		rich_parameter_values: parameters,
	} as const;
	return workspace.latest_build.status === "running"
		? { transition: "stop", on_success: start }
		: {
				...start,
				// Pinning a follow-up build needs template update permission,
				// so only a lone start can name the version.
				template_version_id: workspace.template_active_version_id,
			};
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
 * Refuses an update of `current` that would no longer do what was prepared
 * for `prepared`: the same start or restart, to the same version.
 */
function assertSameUpdate(prepared: Workspace, current: Workspace): void {
	const running = current.latest_build.status === "running";
	if (
		running !== (prepared.latest_build.status === "running") ||
		(!running && !STARTABLE_STATUSES.has(current.latest_build.status)) ||
		current.template_active_version_id !== prepared.template_active_version_id
	) {
		throw updateChangedError(createWorkspaceIdentifier(current));
	}
}

/** Queue a build for the extension, so the server records it as ours. */
export function postBuild(
	client: Pick<BuildClient, "postWorkspaceBuild">,
	workspaceId: string,
	request: BuildRequest,
	signal?: AbortSignal,
): Promise<WorkspaceBuild> {
	throwIfAborted(signal);
	return client.postWorkspaceBuild(workspaceId, {
		...request,
		reason: BUILD_REASON,
	});
}

/**
 * Queue a build and wait for it as `coder` does: stream its logs, warn when
 * no provisioner can take it, and throw unless it succeeds. A build with an
 * `on_success` follow-up waits for that one too. Returns the last build.
 */
export async function runBuild(
	ctx: BuildContext,
	workspaceId: string,
	request: BuildRequest,
): Promise<WorkspaceBuild> {
	const build = await postBuild(ctx.client, workspaceId, request, ctx.signal);
	await awaitBuild(ctx, build);
	if (!request.on_success) {
		return build;
	}
	const next = await nextBuild(ctx, build, FOLLOW_UP_POLLS);
	if (!next) {
		ctx.write(
			`The server has not queued the ${request.on_success.transition} yet; it runs once it does.`,
		);
		return build;
	}
	await awaitBuild(ctx, next);
	return next;
}

/**
 * Start as `coder start` does: activate a dormant workspace, clean up a
 * failed start, and start on the version its policies require.
 */
export async function startWorkspaceViaApi(
	ctx: BuildContext,
	workspace: Workspace,
): Promise<WorkspaceBuild> {
	if (workspace.dormant_at) {
		ctx.write("Activating dormant workspace...");
		throwIfAborted(ctx.signal);
		await ctx.client.updateWorkspaceDormancy(workspace.id, false);
	}
	const last = workspace.latest_build;
	if (last.status === "failed" && last.transition === "start") {
		ctx.write("The last start build failed. Cleaning up before retrying...");
		await runBuild(ctx, workspace.id, { transition: "stop" });
	}
	const active =
		workspace.automatic_updates === "always" ||
		workspace.template_require_active_version;
	return runBuild(ctx, workspace.id, {
		transition: "start",
		template_version_id: active
			? workspace.template_active_version_id
			: last.template_version_id,
	});
}

/**
 * Restart with `start`, by default on the last build's version, refusing to
 * start over a build that superseded the stop. Returns the start build.
 */
export async function restartWorkspace(
	ctx: BuildContext,
	workspace: Workspace,
	start: Pick<BuildRequest, "template_version_id" | "rich_parameter_values"> = {
		template_version_id: workspace.latest_build.template_version_id,
	},
): Promise<WorkspaceBuild> {
	const stop = await runBuild(ctx, workspace.id, { transition: "stop" });
	if (await nextBuild(ctx, stop)) {
		throw new Error(
			`${createWorkspaceIdentifier(workspace)} changed after stopping, so it was not started again, to avoid overwriting another operation.`,
		);
	}
	return runBuild(ctx, workspace.id, { transition: "start", ...start });
}

/** The build that replaced `build` as the latest, read up to `polls` times a second apart. */
async function nextBuild(
	{ client, signal }: BuildContext,
	build: WorkspaceBuild,
	polls = 1,
): Promise<WorkspaceBuild | undefined> {
	for (let poll = 1; ; poll++) {
		const { latest_build: latest } = await client.getWorkspace(
			build.workspace_id,
		);
		throwIfAborted(signal);
		if (latest.id !== build.id) {
			return latest;
		}
		if (poll >= polls) {
			return undefined;
		}
		await sleep(1000, undefined, { signal });
	}
}

async function awaitBuild(
	{ client, write, signal }: BuildContext,
	build: WorkspaceBuild,
): Promise<void> {
	if (build.matched_provisioners?.count === 0) {
		write("No provisioner matches this build's tags, so it stays pending.");
	} else if (build.matched_provisioners?.available === 0) {
		write("No matching provisioner is available yet, so the build waits.");
	}
	const logs = streamBuildLogs(client, write, build.id).catch(
		(error: unknown) => {
			write(`Could not stream the build logs: ${errToStr(error)}`);
			return undefined;
		},
	);
	try {
		const job = await client.waitForBuild(build, signal);
		if (job?.status !== "succeeded") {
			throw new Error(
				`The ${build.transition} build was ${job?.status ?? "not found"}`,
			);
		}
	} finally {
		// Close once open, so a stalled log handshake cannot hold up the result.
		void logs.then((socket) => socket?.close());
	}
}

/**
 * Streams build logs in real-time via a callback. Resolves once the socket
 * opens and rejects if the handshake fails.
 */
export async function streamBuildLogs(
	client: Pick<CoderApi, "getAxiosInstance" | "watchBuildLogsByBuildId">,
	onOutput: (line: string) => void,
	buildId: string,
): Promise<OneWayWebSocket<ProvisionerJobLog>> {
	const socket = await client.watchBuildLogsByBuildId(buildId, []);

	socket.addEventListener("message", (data) => {
		if (data.parseError) {
			onOutput(errToStr(data.parseError, "Failed to parse message"));
		} else {
			onOutput(data.parsedMessage.output);
		}
	});
	onErrorAfterOpen(socket, (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching workspace build logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	await socket.opened;
	void socket.closed.then(() => onOutput("Build complete"));
	return socket;
}

/**
 * Streams agent logs in real-time via a callback. Resolves once the socket
 * opens and rejects if the handshake fails.
 */
export async function streamAgentLogs(
	client: CoderApi,
	onOutput: (line: string) => void,
	agentId: string,
): Promise<OneWayWebSocket<WorkspaceAgentLog[]>> {
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
	onErrorAfterOpen(socket, (error) => {
		const baseUrlRaw = client.getAxiosInstance().defaults.baseURL;
		onOutput(
			`Error watching agent logs on ${baseUrlRaw}: ${errToStr(error, "no further details")}`,
		);
	});

	await socket.opened;
	return socket;
}

/** Handshake errors are left to `socket.opened`, which rejects with them. */
function onErrorAfterOpen<T>(
	socket: OneWayWebSocket<T>,
	handler: EventHandler<T, "error">,
): void {
	let isOpen = false;
	socket.addEventListener("open", () => {
		isOpen = true;
	});
	socket.addEventListener("error", (event) => {
		if (isOpen) {
			handler(event);
		}
	});
}
