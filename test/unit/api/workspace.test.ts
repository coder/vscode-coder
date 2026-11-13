import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	LazyStream,
	restartWorkspace,
	runBuild,
	startWorkspace,
	startWorkspaceViaApi,
	updateWorkspace,
	updateWorkspaceViaApi,
	type BuildContext,
} from "@/api/workspace";

import { workspace as createWorkspace } from "@repo/mocks";

import { createMockOneWaySocket } from "../../mocks/testHelpers";

import type {
	CreateWorkspaceBuildRequest,
	Workspace,
	WorkspaceBuild,
	WorkspaceTransition,
} from "coder/site/src/api/typesGenerated";

import type { ServerFeatureSet } from "@/featureSet";
import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

vi.mock(import("node:child_process"), async (importOriginal) => ({
	...(await importOriginal()),
	spawn: vi.fn(),
}));

const { spawn } = await import("node:child_process");

const GLOBAL_FLAGS = ["--url", "https://test.coder.com", "--use-keyring=false"];
const REASON = { reason: "vscode_connection" } as const;

/** Arguments of the first CLI invocation. */
const spawnedArgs = () => vi.mocked(spawn).mock.calls[0][1];

function mockStream(): UnidirectionalStream<unknown> {
	return {
		url: "ws://test",
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		close: vi.fn(),
	};
}

type StreamFactory = () => Promise<UnidirectionalStream<unknown>>;

/** Creates a factory whose promise can be resolved manually. */
function deferredFactory() {
	let resolve!: (s: UnidirectionalStream<unknown>) => void;
	const factory: StreamFactory = vi.fn().mockReturnValue(
		new Promise<UnidirectionalStream<unknown>>((r) => {
			resolve = r;
		}),
	);
	return {
		factory,
		resolve: (s?: UnidirectionalStream<unknown>) => resolve(s ?? mockStream()),
	};
}

function createUpdateCtx(
	overrides: {
		workspace?: Omit<Partial<Workspace>, "latest_build"> & {
			latest_build?: Partial<WorkspaceBuild>;
		};
		serverFeatures?: Partial<ServerFeatureSet>;
	} = {},
) {
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
		get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
	} as never);
	const workspace = createWorkspace({
		outdated: true,
		latest_build: { status: "running", transition: "start" },
		...overrides.workspace,
	});
	const finalWorkspace = createWorkspace({
		outdated: false,
		latest_build: { status: "running" },
	});
	const restClient = {
		getWorkspace: vi.fn().mockResolvedValue(finalWorkspace),
		postWorkspaceBuild: vi
			.fn()
			.mockResolvedValue({ ...workspace.latest_build, id: "queued-build" }),
		waitForBuild: vi.fn().mockResolvedValue({
			...workspace.latest_build.job,
			status: "succeeded",
		}),
		updateWorkspaceDormancy: vi.fn().mockResolvedValue(workspace),
		watchBuildLogsByBuildId: vi
			.fn()
			.mockImplementation(() => Promise.resolve(createMockOneWaySocket())),
		getAxiosInstance: vi.fn().mockReturnValue({ defaults: {} }),
	};
	const ctx = {
		restClient,
		auth: {
			store: "cli" as const,
			url: "https://test.coder.com",
			useKeyring: false,
			refuseRedirects: false,
		},
		binPath: "/usr/bin/coder",
		workspace,
		write: vi.fn<(data: string) => void>(),
		serverFeatures: {
			tasks: false,
			onSuccessBuild: false,
			customSessionAppNames: false,
			...overrides.serverFeatures,
		},
	};
	return { ctx, restClient, finalWorkspace };
}

/** Drives mocked spawn() so tests can fire stdout/stderr + close at will. */
function controlSpawn() {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		stdin: { end: ReturnType<typeof vi.fn> };
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.stdin = { end: vi.fn() };
	const { promise: spawned, resolve: resolveSpawned } =
		Promise.withResolvers<void>();
	vi.mocked(spawn).mockImplementation(() => {
		resolveSpawned();
		return proc as never;
	});
	return {
		spawned,
		stdinEnd: proc.stdin.end,
		stderr(data: string) {
			proc.stderr.emit("data", Buffer.from(data));
		},
		async close(exitCode: number | null, signal?: NodeJS.Signals) {
			await spawned;
			proc.emit("close", exitCode, signal ?? null);
		},
		async error(err: Error) {
			await spawned;
			proc.emit("error", err);
		},
	};
}

describe("LazyStream", () => {
	it("opens once and ignores subsequent calls", async () => {
		const factory: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		const lazy = new LazyStream();

		await lazy.open(factory);
		await lazy.open(factory);

		expect(factory).toHaveBeenCalledOnce();
	});

	it("can reopen after close", async () => {
		const factory: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		const lazy = new LazyStream();

		await lazy.open(factory);
		lazy.close();
		await lazy.open(factory);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	it("closes the underlying stream", async () => {
		const stream = mockStream();
		const lazy = new LazyStream();

		await lazy.open(() => Promise.resolve(stream));
		lazy.close();

		expect(stream.close).toHaveBeenCalledOnce();
	});

	it("deduplicates concurrent opens", async () => {
		const { factory, resolve } = deferredFactory();
		const lazy = new LazyStream();

		const p1 = lazy.open(factory);
		const p2 = lazy.open(factory);
		resolve();
		await Promise.all([p1, p2]);

		expect(factory).toHaveBeenCalledOnce();
	});

	it("allows reopening after close during pending open", async () => {
		const { factory, resolve } = deferredFactory();
		const lazy = new LazyStream();

		const p = lazy.open(factory);
		lazy.close();
		resolve();
		await p.catch(() => {});

		const factory2: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		await lazy.open(factory2);
		expect(factory2).toHaveBeenCalledOnce();
	});
});

describe("updateWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("runs coder update on servers before 2.36", async () => {
		const { ctx, restClient, finalWorkspace } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.close(0);

		await expect(result).resolves.toBe(finalWorkspace);
		expect(spawnedArgs()).toEqual([
			...GLOBAL_FLAGS,
			"update",
			"--",
			"testuser/test-workspace",
		]);
		expect(sp.stdinEnd).toHaveBeenCalled();
		expect(restClient.getWorkspace).toHaveBeenCalledWith(ctx.workspace.id);
	});

	it("hides the host session token from the CLI", async () => {
		vi.stubEnv("CODER_SESSION_TOKEN", "host-token");
		const { ctx } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.close(0);
		await result;

		expect(spawn).toHaveBeenCalledWith("/usr/bin/coder", expect.any(Array), {
			env: expect.not.objectContaining({ CODER_SESSION_TOKEN: "host-token" }),
		});
	});

	it("passes collected parameters as --parameter flags", async () => {
		const { ctx } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, [
			{ name: "region", value: "us-east" },
			{ name: "size", value: "large" },
		]);
		await sp.close(0);
		await result;

		expect(spawnedArgs()).toEqual([
			...GLOBAL_FLAGS,
			"update",
			"--parameter",
			"region=us-east",
			"--parameter",
			"size=large",
			"--",
			"testuser/test-workspace",
		]);
	});

	it("rejects when the process exits non-zero", async () => {
		const { ctx, restClient } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.spawned;
		sp.stderr("auth failed");
		await sp.close(1);

		await expect(result).rejects.toThrow(/exited with code 1.*auth failed/);
		expect(restClient.getWorkspace).toHaveBeenCalledOnce();
	});

	it("rejects when spawn emits an error (e.g. missing binary)", async () => {
		const { ctx, restClient } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.error(new Error("spawn /usr/bin/coder ENOENT"));
		// Real Node fires `error` then `close(null, null)` on ENOENT.
		await sp.close(null);

		await expect(result).rejects.toThrow(/ENOENT/);
		expect(restClient.getWorkspace).toHaveBeenCalledOnce();
	});

	it("reports the terminating signal when the process is killed", async () => {
		const { ctx } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.close(null, "SIGTERM");

		await expect(result).rejects.toThrow(/signal SIGTERM/);
	});

	interface OneBuildCase {
		name: string;
		status: WorkspaceBuild["status"];
		request: CreateWorkspaceBuildRequest;
	}

	it.each<OneBuildCase>([
		{
			name: "restarts a running workspace in one build",
			status: "running",
			request: {
				transition: "stop",
				reason: "vscode_connection",
				on_success: {
					transition: "start",
					rich_parameter_values: [{ name: "region", value: "us-east" }],
				},
			},
		},
		{
			name: "starts a stopped workspace on the active version",
			status: "stopped",
			request: {
				transition: "start",
				reason: "vscode_connection",
				template_version_id: "version-1",
				rich_parameter_values: [{ name: "region", value: "us-east" }],
			},
		},
	])("$name from 2.36", async ({ status, request }) => {
		const { ctx, restClient } = createUpdateCtx({
			workspace: { latest_build: { status } },
			serverFeatures: { onSuccessBuild: true },
		});
		const accepted = { ...ctx.workspace.latest_build, id: "accepted-build" };
		restClient.getWorkspace.mockResolvedValue(ctx.workspace);
		restClient.postWorkspaceBuild.mockResolvedValue(accepted);

		await expect(
			updateWorkspace(ctx, [{ name: "region", value: "us-east" }]),
		).resolves.toEqual({ ...ctx.workspace, latest_build: accepted });
		expect(restClient.postWorkspaceBuild).toHaveBeenCalledWith(
			ctx.workspace.id,
			request,
		);
	});

	it.each([
		{ change: "a start became a restart", status: "running" as const },
		{ change: "the version changed", version: "another-version" },
	])("refuses an update when $change since it was prepared", async (change) => {
		const { ctx, restClient } = createUpdateCtx({
			workspace: { latest_build: { status: "stopped" } },
		});
		restClient.getWorkspace.mockResolvedValue(
			createWorkspace({
				latest_build: { status: change.status ?? "stopped" },
				template_active_version_id:
					change.version ?? ctx.workspace.template_active_version_id,
			}),
		);

		await expect(updateWorkspace(ctx, [])).rejects.toThrow("changed");

		expect(spawn).not.toHaveBeenCalled();
		expect(restClient.postWorkspaceBuild).not.toHaveBeenCalled();
	});
});

describe("startWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs coder start when the workspace is stopped", async () => {
		const { ctx, restClient, finalWorkspace } = createUpdateCtx({
			workspace: { latest_build: { status: "stopped", transition: "stop" } },
		});
		const sp = controlSpawn();

		const result = startWorkspace(ctx);
		await sp.close(0);

		await expect(result).resolves.toBe(finalWorkspace);
		expect(spawnedArgs()).toEqual([
			...GLOBAL_FLAGS,
			"start",
			"--yes",
			"--reason",
			"vscode_connection",
			"--",
			"testuser/test-workspace",
		]);
		expect(restClient.getWorkspace).toHaveBeenCalledWith(ctx.workspace.id);
	});

	it("no-ops when the workspace is already running", async () => {
		const { ctx, restClient } = createUpdateCtx();
		await expect(startWorkspace(ctx)).resolves.toBe(ctx.workspace);
		expect(spawn).not.toHaveBeenCalled();
		expect(restClient.getWorkspace).not.toHaveBeenCalled();
	});
});

describe("panel builds", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	type Overrides = NonNullable<Parameters<typeof createUpdateCtx>[0]>;

	/**
	 * A build context whose queued builds are named after their transition.
	 * The workspace reads back with the last queued build as its latest.
	 */
	function setup(overrides: Overrides = {}) {
		const { ctx: cli, restClient: client } = createUpdateCtx(overrides);
		let latest = cli.workspace.latest_build;
		client.postWorkspaceBuild.mockImplementation(
			(_id: string, request: { transition: WorkspaceTransition }) => {
				latest = {
					...cli.workspace.latest_build,
					id: `${request.transition}-build`,
					transition: request.transition,
				};
				return Promise.resolve(latest);
			},
		);
		client.getWorkspace.mockImplementation(() =>
			Promise.resolve({ ...cli.workspace, latest_build: latest }),
		);
		const abort = new AbortController();
		const ctx: BuildContext = {
			client,
			write: cli.write,
			signal: abort.signal,
		};
		const posted = () =>
			client.postWorkspaceBuild.mock.calls.map(([, request]) => request);
		/** Aborts as the next build wait ends, as a session change would. */
		const abortAfterWait = () =>
			client.waitForBuild.mockImplementationOnce(() => {
				abort.abort();
				return Promise.resolve({ status: "succeeded" });
			});
		return { ...cli, ctx, client, abort, posted, abortAfterWait };
	}

	describe("runBuild", () => {
		it("queues the build for the extension and waits for it, streaming its logs", async () => {
			const h = setup();
			const stream = createMockOneWaySocket();
			h.client.watchBuildLogsByBuildId.mockResolvedValueOnce(stream);

			const build = await runBuild(h.ctx, h.workspace.id, {
				transition: "stop",
			});

			expect(h.posted()).toEqual([{ transition: "stop", ...REASON }]);
			expect(h.client.waitForBuild).toHaveBeenCalledWith(build, h.ctx.signal);
			expect(h.client.watchBuildLogsByBuildId).toHaveBeenCalledWith(
				"stop-build",
				[],
			);
			await vi.waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
		});

		it.each([
			["fails", () => Promise.reject(new Error("Build 1 failed")), "failed"],
			[
				"is canceled",
				() => Promise.resolve({ status: "canceled" }),
				"The stop build was canceled",
			],
		])(
			"throws and stops streaming when the build %s",
			async (_, wait, error) => {
				const h = setup();
				const stream = createMockOneWaySocket();
				h.client.watchBuildLogsByBuildId.mockResolvedValueOnce(stream);
				h.client.waitForBuild.mockImplementation(wait);

				await expect(
					runBuild(h.ctx, h.workspace.id, { transition: "stop" }),
				).rejects.toThrow(error);
				await vi.waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
			},
		);

		it("returns without waiting for a stalled log stream", async () => {
			const h = setup();
			h.client.watchBuildLogsByBuildId.mockReturnValueOnce(
				new Promise(() => {}),
			);

			await expect(
				runBuild(h.ctx, h.workspace.id, { transition: "stop" }),
			).resolves.toMatchObject({ id: "stop-build" });
		});

		it.each([
			[{ count: 0, available: 0 }, "No provisioner matches"],
			[{ count: 1, available: 0 }, "No matching provisioner is available"],
		])(
			"warns when no provisioner can take the build",
			async (matched, warning) => {
				const h = setup({
					workspace: {
						latest_build: {
							matched_provisioners: { ...matched, most_recently_seen: "" },
						},
					},
				});

				await runBuild(h.ctx, h.workspace.id, { transition: "stop" });

				expect(h.write).toHaveBeenCalledWith(expect.stringContaining(warning));
			},
		);

		it("does not queue once aborted", async () => {
			const h = setup();
			h.abort.abort();

			await expect(
				runBuild(h.ctx, h.workspace.id, { transition: "delete" }),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(h.client.postWorkspaceBuild).not.toHaveBeenCalled();
		});

		describe("with an on_success follow-up", () => {
			const STOP_THEN_START = {
				transition: "stop",
				on_success: { transition: "start" },
			} as const;

			it("waits for the build the server queues after it", async () => {
				const h = setup();
				const start = { ...h.workspace.latest_build, id: "server-start" };
				h.client.getWorkspace.mockResolvedValueOnce({
					...h.workspace,
					latest_build: start,
				});

				await expect(
					runBuild(h.ctx, h.workspace.id, STOP_THEN_START),
				).resolves.toBe(start);
				expect(h.client.waitForBuild.mock.calls).toEqual([
					[expect.objectContaining({ id: "stop-build" }), h.ctx.signal],
					[start, h.ctx.signal],
				]);
			});

			it("notes when the server has not queued it in time", async () => {
				vi.useFakeTimers();
				const h = setup();

				const running = runBuild(h.ctx, h.workspace.id, STOP_THEN_START);
				await vi.runAllTimersAsync();
				await running;

				expect(h.client.waitForBuild).toHaveBeenCalledOnce();
				expect(h.client.getWorkspace).toHaveBeenCalledTimes(30);
				expect(h.write).toHaveBeenCalledWith(
					expect.stringContaining("has not queued the start yet"),
				);
			});
		});
	});

	describe("startWorkspaceViaApi", () => {
		it.each([
			{ on: "the last build's version", policy: {}, version: "v-last" },
			{
				on: "the active version when it updates automatically",
				policy: { automatic_updates: "always" },
				version: "v-active",
			},
			{
				on: "the active version when the template requires it",
				policy: { template_require_active_version: true },
				version: "v-active",
			},
		] as const)("starts on $on", async ({ policy, version }) => {
			const h = setup({
				workspace: {
					...policy,
					template_active_version_id: "v-active",
					latest_build: { status: "stopped", template_version_id: "v-last" },
				},
			});

			await startWorkspaceViaApi(h.ctx, h.workspace);

			expect(h.posted()).toEqual([
				{ transition: "start", template_version_id: version, ...REASON },
			]);
		});

		it("activates a dormant workspace first", async () => {
			const h = setup({
				workspace: {
					dormant_at: "2024-01-01T00:00:00Z",
					latest_build: { status: "stopped" },
				},
			});

			await startWorkspaceViaApi(h.ctx, h.workspace);

			expect(h.write).toHaveBeenCalledWith("Activating dormant workspace...");
			expect(h.client.updateWorkspaceDormancy).toHaveBeenCalledWith(
				h.workspace.id,
				false,
			);
			expect(
				h.client.updateWorkspaceDormancy.mock.invocationCallOrder[0],
			).toBeLessThan(h.client.postWorkspaceBuild.mock.invocationCallOrder[0]);
		});

		it("cleans up a failed start before starting", async () => {
			const h = setup({
				workspace: { latest_build: { status: "failed", transition: "start" } },
			});

			await startWorkspaceViaApi(h.ctx, h.workspace);

			expect(h.posted()).toEqual([
				{ transition: "stop", ...REASON },
				expect.objectContaining({ transition: "start", ...REASON }),
			]);
		});

		it("does not start once aborted during the cleanup", async () => {
			const h = setup({
				workspace: { latest_build: { status: "failed", transition: "start" } },
			});
			h.abortAfterWait();

			await expect(
				startWorkspaceViaApi(h.ctx, h.workspace),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(h.client.postWorkspaceBuild).toHaveBeenCalledOnce();
		});
	});

	describe("restartWorkspace", () => {
		const versions = {
			workspace: {
				template_active_version_id: "v-new",
				latest_build: { template_version_id: "v-original" },
			},
		};

		it("waits for its stop, then starts on the original version", async () => {
			const h = setup(versions);

			await restartWorkspace(h.ctx, h.workspace);

			expect(h.client.waitForBuild).toHaveBeenCalledTimes(2);
			expect(h.posted()).toEqual([
				{ transition: "stop", ...REASON },
				{ transition: "start", template_version_id: "v-original", ...REASON },
			]);
		});

		it("does not start over a build that superseded its stop", async () => {
			const h = setup(versions);
			h.client.getWorkspace.mockResolvedValue(
				createWorkspace({ latest_build: { id: "another-build" } }),
			);

			await expect(restartWorkspace(h.ctx, h.workspace)).rejects.toThrow(
				"changed after stopping",
			);
			expect(h.client.postWorkspaceBuild).toHaveBeenCalledOnce();
		});

		it("does not start once aborted", async () => {
			const h = setup(versions);
			h.abortAfterWait();

			await expect(restartWorkspace(h.ctx, h.workspace)).rejects.toMatchObject({
				name: "AbortError",
			});
			expect(h.client.postWorkspaceBuild).toHaveBeenCalledOnce();
		});
	});

	describe("updateWorkspaceViaApi", () => {
		const parameters = [{ name: "region", value: "us-east" }];
		const start = {
			transition: "start",
			template_version_id: "version-1",
			rich_parameter_values: parameters,
			...REASON,
		};

		it.each([
			{ status: "running", builds: [{ transition: "stop", ...REASON }, start] },
			{ status: "stopped", builds: [start] },
		] as const)(
			"updates a $status workspace before 2.36",
			async ({ status, builds }) => {
				const h = setup({ workspace: { latest_build: { status } } });

				await updateWorkspaceViaApi(h.ctx, h.workspace, h.serverFeatures, [
					...parameters,
				]);

				expect(spawn).not.toHaveBeenCalled();
				expect(h.posted()).toEqual(builds);
			},
		);

		it("restarts in one build from 2.36 and waits for the queued start", async () => {
			const h = setup({ serverFeatures: { onSuccessBuild: true } });
			const queued = { ...h.workspace.latest_build, id: "server-start" };
			h.client.getWorkspace
				.mockResolvedValueOnce(h.workspace)
				.mockResolvedValueOnce({ ...h.workspace, latest_build: queued });

			await updateWorkspaceViaApi(h.ctx, h.workspace, h.serverFeatures, [
				...parameters,
			]);

			expect(h.posted()).toEqual([
				{
					transition: "stop",
					on_success: {
						transition: "start",
						rich_parameter_values: parameters,
					},
					...REASON,
				},
			]);
			expect(h.client.waitForBuild.mock.calls).toEqual([
				[expect.objectContaining({ id: "stop-build" }), h.ctx.signal],
				[queued, h.ctx.signal],
			]);
		});
	});
});
