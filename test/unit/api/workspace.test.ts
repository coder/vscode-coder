import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { LazyStream, startWorkspace, updateWorkspace } from "@/api/workspace";
import { type FeatureSet } from "@/featureSet";
import { type UnidirectionalStream } from "@/websocket/eventStreamConnection";

import { workspace as createWorkspace } from "@repo/mocks";

import type { Api } from "coder/site/src/api/api";
import type {
	TemplateVersionParameter,
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

vi.mock(import("node:child_process"), async (importOriginal) => ({
	...(await importOriginal()),
	spawn: vi.fn(),
}));
const { spawn } = await import("node:child_process");

const featureSet: FeatureSet = {
	vscodessh: true,
	proxyLogDirectory: true,
	wildcardSSH: true,
	buildReason: true,
	cliUpdate: true,
	keyringAuth: true,
	keyringTokenRead: true,
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
		updateWorkspaceVersion: vi.fn().mockResolvedValue(workspace.latest_build),
		waitForBuild: vi.fn().mockResolvedValue({
			...workspace.latest_build.job,
			status: "succeeded",
		}),
		getTemplateVersionRichParameters: vi.fn().mockResolvedValue([]),
		getWorkspaceBuildParameters: vi.fn().mockResolvedValue([]),
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
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	let resolveSpawned!: () => void;
	const spawned = new Promise<void>((resolve) => {
		resolveSpawned = resolve;
	});
	vi.mocked(spawn).mockImplementation(() => {
		resolveSpawned();
		return proc as never;
	});
	return {
		spawned,
		stderr(data: string) {
			proc.stderr.emit("data", Buffer.from(data));
		},
		async close(exitCode: number) {
			await spawned;
			proc.emit("close", exitCode);
		},
	};
}

interface QuickInputMock {
	mock: Record<string, unknown> & {
		show: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
	accept: (overrides?: Record<string, unknown>) => void;
	hide: () => void;
}

function quickInputMock(): QuickInputMock {
	let acceptCb: () => void = () => {};
	let hideCb: () => void = () => {};
	let changeCb: (v: string) => void = () => {};
	const mock = {
		title: "",
		step: 0,
		totalSteps: 0,
		prompt: "",
		placeholder: "",
		value: "",
		validationMessage: "",
		ignoreFocusOut: false,
		items: [] as readonly unknown[],
		selectedItems: [] as readonly unknown[],
		onDidAccept: vi.fn((cb: () => void) => {
			acceptCb = cb;
			return { dispose: vi.fn() };
		}),
		onDidHide: vi.fn((cb: () => void) => {
			hideCb = cb;
			return { dispose: vi.fn() };
		}),
		onDidChangeValue: vi.fn((cb: (v: string) => void) => {
			changeCb = cb;
			return { dispose: vi.fn() };
		}),
		show: vi.fn(),
		dispose: vi.fn(),
	};
	return {
		mock,
		accept(overrides) {
			Object.assign(mock, overrides ?? {});
			if (overrides && "value" in overrides) changeCb(mock.value);
			acceptCb();
		},
		hide() {
			hideCb();
		},
	};
}

function mockCreateInputBox() {
	const qi = quickInputMock();
	vi.mocked(vscode.window.createInputBox).mockReturnValue(
		qi.mock as unknown as vscode.InputBox,
	);
	return qi;
}

function mockCreateQuickPick() {
	const qi = quickInputMock();
	vi.mocked(vscode.window.createQuickPick).mockReturnValue(
		qi.mock as unknown as vscode.QuickPick<vscode.QuickPickItem>,
	);
	return qi;
}

async function flushMicrotasks(times = 4) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

function setupUpdate(
	params: Array<Partial<TemplateVersionParameter>> = [],
	opts: Parameters<typeof createUpdateCtx>[0] = {},
) {
	const ctxBundle = createUpdateCtx(opts);
	ctxBundle.restClient.getTemplateVersionRichParameters.mockResolvedValue(
		params.map(param),
	);
	return { ...ctxBundle, sp: controlSpawn() };
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

function param(overrides: Partial<TemplateVersionParameter> = {}) {
	return {
		name: "environment",
		display_name: "Environment",
		description: "",
		description_plaintext: "",
		type: "string",
		form_type: "input",
		mutable: true,
		default_value: "",
		icon: "",
		options: [],
		required: true,
		ephemeral: false,
		...overrides,
	} as TemplateVersionParameter;
}

describe("updateWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{
			kind: "text input",
			param: { name: "environment" } as Partial<TemplateVersionParameter>,
			mock: mockCreateInputBox,
			accept: { value: "dev" },
			expected: '--parameter "environment=dev"',
		},
		{
			kind: "bool quick pick",
			param: { name: "enabled", type: "bool" },
			mock: mockCreateQuickPick,
			accept: { selectedItems: [{ label: "True", value: "true" }] },
			expected: '--parameter "enabled=true"',
		},
		{
			kind: "options quick pick",
			param: {
				name: "size",
				options: [
					{ name: "Small", description: "", value: "s", icon: "" },
					{ name: "Large", description: "", value: "l", icon: "" },
				],
			},
			mock: mockCreateQuickPick,
			accept: { selectedItems: [{ value: "l" }] },
			expected: '--parameter "size=l"',
		},
		{
			kind: "fallback text input for unknown types",
			param: { name: "x", type: "list(string)" },
			mock: mockCreateInputBox,
			accept: { value: "[]" },
			expected: '--parameter "x=[]"',
		},
	])(
		"collects the value via $kind",
		async ({ param: p, mock, accept, expected }) => {
			const { ctx, sp, finalWorkspace } = setupUpdate([p]);
			const qi = mock();

			const result = updateWorkspace(ctx);
			await flushMicrotasks();
			qi.accept(accept);
			await sp.close(0);

			await expect(result).resolves.toBe(finalWorkspace);
			expect(spawn).toHaveBeenCalledWith(
				expect.stringContaining(expected),
				expect.objectContaining({ shell: true }),
			);
		},
	);

	it("skips parameters that already have a value or default", async () => {
		const { ctx, restClient, sp } = setupUpdate([
			{ name: "existing" },
			{ name: "with_default", default_value: "foo" },
			{ name: "optional", required: false },
		]);
		restClient.getWorkspaceBuildParameters.mockResolvedValue([
			{ name: "existing", value: "kept" },
		]);

		const result = updateWorkspace(ctx);
		await sp.close(0);
		await result;

		expect(vscode.window.createInputBox).not.toHaveBeenCalled();
		expect(spawn).toHaveBeenCalledWith(
			expect.not.stringContaining("--parameter"),
			expect.anything(),
		);
	});

	it("throws when the user cancels a parameter prompt", async () => {
		const { ctx } = setupUpdate([{}]);
		const qi = mockCreateInputBox();

		const result = updateWorkspace(ctx);
		await flushMicrotasks();
		qi.hide();

		await expect(result).rejects.toThrow("Workspace update cancelled");
		expect(spawn).not.toHaveBeenCalled();
	});

	it("steps the input title across multiple required params", async () => {
		const { ctx, sp } = setupUpdate([{ name: "a" }, { name: "b" }]);
		const inputs = [quickInputMock(), quickInputMock()];
		vi.mocked(vscode.window.createInputBox)
			.mockReturnValueOnce(inputs[0].mock as unknown as vscode.InputBox)
			.mockReturnValueOnce(inputs[1].mock as unknown as vscode.InputBox);

		const result = updateWorkspace(ctx);
		await flushMicrotasks();
		inputs[0].accept({ value: "first" });
		await flushMicrotasks();
		inputs[1].accept({ value: "second" });
		await sp.close(0);
		await result;

		expect(inputs.map((i) => [i.mock.step, i.mock.totalSteps])).toEqual([
			[1, 2],
			[2, 2],
		]);
	});

	it("rejects when the process exits non-zero", async () => {
		const { ctx, restClient } = createUpdateCtx();
		const sp = controlSpawn();

		const result = updateWorkspace(ctx);
		await sp.spawned;
		sp.stderr("auth failed");
		await sp.close(1);

		await expect(result).rejects.toThrow(/exited with code 1.*auth failed/);
		expect(restClient.getWorkspace).not.toHaveBeenCalled();
	});

	it("falls back to the API update path when coder update is unsupported", async () => {
		const { ctx, restClient, finalWorkspace } = createUpdateCtx({
			featureSet: { cliUpdate: false },
		});

		await expect(updateWorkspace(ctx)).resolves.toBe(finalWorkspace);

		expect(spawn).not.toHaveBeenCalled();
		expect(restClient.getTemplateVersionRichParameters).not.toHaveBeenCalled();
		expect(restClient.stopWorkspace).toHaveBeenCalledWith(ctx.workspace.id);
		expect(restClient.updateWorkspaceVersion).toHaveBeenCalledWith(
			ctx.workspace,
		);
	});

	it("does not stop before API fallback update when the workspace is not running", async () => {
		const { ctx, restClient } = createUpdateCtx({
			workspace: { latest_build: { status: "stopped", transition: "stop" } },
			featureSet: { cliUpdate: false },
		});

		await updateWorkspace(ctx);

		expect(restClient.stopWorkspace).not.toHaveBeenCalled();
		expect(restClient.updateWorkspaceVersion).toHaveBeenCalledWith(
			ctx.workspace,
		);
	});

	it("throws before update when the API fallback stop is canceled", async () => {
		const { ctx, restClient } = createUpdateCtx({
			featureSet: { cliUpdate: false },
		});
		restClient.waitForBuild.mockResolvedValueOnce({
			...ctx.workspace.latest_build.job,
			status: "canceled",
		});

		await expect(updateWorkspace(ctx)).rejects.toThrow(
			"Workspace update canceled during stop",
		);
		expect(restClient.updateWorkspaceVersion).not.toHaveBeenCalled();
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
		expect(spawn).toHaveBeenCalledWith(
			'"/usr/bin/coder" --url "https://test.coder.com" start --yes --reason vscode_connection testuser/test-workspace',
			expect.objectContaining({ shell: true }),
		);
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

		expect(spawn).toHaveBeenCalledWith(
			'"/usr/bin/coder" --url "https://test.coder.com" start --yes testuser/test-workspace',
			expect.objectContaining({ shell: true }),
		);
	});
});
