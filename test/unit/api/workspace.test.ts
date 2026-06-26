import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { LazyStream, startWorkspace, updateWorkspace } from "@/api/workspace";

import { workspace as createWorkspace } from "@repo/mocks";

import type { Api } from "coder/site/src/api/api";
import type {
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

import type { FeatureSet } from "@/featureSet";
import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

vi.mock(import("node:child_process"), async (importOriginal) => ({
	...(await importOriginal()),
	spawn: vi.fn(),
}));
const { spawn } = await import("node:child_process");

const featureSet: FeatureSet = {
	cliLogin: true,
	proxyLogDirectory: true,
	wildcardSSH: true,
	buildReason: true,
	cliUpdate: true,
	keyringAuth: true,
	tokenRead: true,
	supportBundle: true,
};

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
		featureSet?: Partial<FeatureSet>;
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
		stopWorkspace: vi
			.fn()
			.mockResolvedValue({ ...workspace.latest_build, status: "stopped" }),
		startWorkspace: vi.fn().mockResolvedValue(workspace.latest_build),
		getTemplate: vi
			.fn()
			.mockResolvedValue({ active_version_id: "active-version-id" }),
		waitForBuild: vi.fn().mockResolvedValue({
			...workspace.latest_build.job,
			status: "succeeded",
		}),
	};
	const ctx = {
		restClient: restClient as unknown as Api,
		auth: { mode: "url" as const, url: "https://test.coder.com" },
		binPath: "/usr/bin/coder",
		workspace,
		write: vi.fn<(data: string) => void>(),
		featureSet: { ...featureSet, ...overrides.featureSet },
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

	it("runs coder update and resolves with the refreshed workspace", async () => {
		const { ctx, restClient, finalWorkspace } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.close(0);

		await expect(result).resolves.toBe(finalWorkspace);
		expect(spawn).toHaveBeenCalledWith("/usr/bin/coder", [
			"--url",
			"https://test.coder.com",
			"update",
			"testuser/test-workspace",
		]);
		expect(sp.stdinEnd).toHaveBeenCalled();
		expect(restClient.getWorkspace).toHaveBeenCalledWith(ctx.workspace.id);
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

		expect(spawn).toHaveBeenCalledWith("/usr/bin/coder", [
			"--url",
			"https://test.coder.com",
			"update",
			"--parameter",
			"region=us-east",
			"--parameter",
			"size=large",
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
		expect(restClient.getWorkspace).not.toHaveBeenCalled();
	});

	it("rejects when spawn emits an error (e.g. missing binary)", async () => {
		const { ctx, restClient } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.error(new Error("spawn /usr/bin/coder ENOENT"));
		// Real Node fires `error` then `close(null, null)` on ENOENT.
		await sp.close(null);

		await expect(result).rejects.toThrow(/ENOENT/);
		expect(restClient.getWorkspace).not.toHaveBeenCalled();
	});

	it("reports the terminating signal when the process is killed", async () => {
		const { ctx } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx, []);
		await sp.close(null, "SIGTERM");

		await expect(result).rejects.toThrow(/signal SIGTERM/);
	});

	it("falls back to the API update path when coder update is unsupported", async () => {
		const { ctx, restClient, finalWorkspace } = createUpdateCtx({
			featureSet: { cliUpdate: false },
		});

		await expect(updateWorkspace(ctx, [])).resolves.toBe(finalWorkspace);

		expect(spawn).not.toHaveBeenCalled();
		expect(restClient.stopWorkspace).toHaveBeenCalledWith(ctx.workspace.id);
		expect(restClient.startWorkspace).toHaveBeenCalledWith(
			ctx.workspace.id,
			"active-version-id",
			undefined,
			[],
		);
	});

	it("passes collected parameters when using the API fallback", async () => {
		const { ctx, restClient } = createUpdateCtx({
			featureSet: { cliUpdate: false },
		});
		const parameters = [{ name: "region", value: "us-east" }];

		await updateWorkspace(ctx, parameters);

		expect(restClient.startWorkspace).toHaveBeenCalledWith(
			ctx.workspace.id,
			"active-version-id",
			undefined,
			parameters,
		);
	});

	it("does not stop before API fallback update when the workspace is not running", async () => {
		const { ctx, restClient } = createUpdateCtx({
			workspace: { latest_build: { status: "stopped", transition: "stop" } },
			featureSet: { cliUpdate: false },
		});

		await updateWorkspace(ctx, []);

		expect(restClient.stopWorkspace).not.toHaveBeenCalled();
		expect(restClient.startWorkspace).toHaveBeenCalledWith(
			ctx.workspace.id,
			"active-version-id",
			undefined,
			[],
		);
	});

	it("throws before update when the API fallback stop is cancelled", async () => {
		const { ctx, restClient } = createUpdateCtx({
			featureSet: { cliUpdate: false },
		});
		restClient.waitForBuild.mockResolvedValueOnce({
			...ctx.workspace.latest_build.job,
			status: "canceled",
		});

		await expect(updateWorkspace(ctx, [])).rejects.toThrow(
			"Workspace update cancelled during stop",
		);
		expect(restClient.startWorkspace).not.toHaveBeenCalled();
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
		expect(spawn).toHaveBeenCalledWith("/usr/bin/coder", [
			"--url",
			"https://test.coder.com",
			"start",
			"--yes",
			"--reason",
			"vscode_connection",
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

	it("omits --reason when buildReason feature is unavailable", async () => {
		const { ctx } = createUpdateCtx({
			workspace: { latest_build: { status: "stopped", transition: "stop" } },
			featureSet: { buildReason: false },
		});
		const sp = controlSpawn();

		const result = startWorkspace(ctx);
		await sp.close(0);
		await result;

		expect(spawn).toHaveBeenCalledWith("/usr/bin/coder", [
			"--url",
			"https://test.coder.com",
			"start",
			"--yes",
			"testuser/test-workspace",
		]);
	});
});
