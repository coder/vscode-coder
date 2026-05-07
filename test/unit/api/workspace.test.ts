import { describe, expect, it, vi } from "vitest";

import { LazyStream, updateWorkspace } from "@/api/workspace";
import { type FeatureSet } from "@/featureSet";
import { type UnidirectionalStream } from "@/websocket/eventStreamConnection";

import { workspace as createWorkspace } from "../../mocks/workspace";

import type { Api } from "coder/site/src/api/api";
import type {
	CreateWorkspaceBuildRequest,
	ProvisionerJob,
	TemplateVersionParameter,
	TemplateVersionParameterOption,
	Workspace,
	WorkspaceBuild,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

type UpdateWorkspaceContext = Parameters<typeof updateWorkspace>[0];
interface UpdateRestClient {
	getWorkspace: (workspaceId: string) => Promise<Workspace>;
	getWorkspaceBuildParameters: (
		workspaceBuildId: string,
	) => Promise<WorkspaceBuildParameter[]>;
	getTemplateVersionRichParameters: (
		versionId: string,
	) => Promise<TemplateVersionParameter[]>;
	getDynamicParameters: (
		templateVersionId: string,
		ownerId: string,
		oldBuildParameters: WorkspaceBuildParameter[],
	) => Promise<TemplateVersionParameter[]>;
	postWorkspaceBuild: (
		workspaceId: string,
		data: CreateWorkspaceBuildRequest,
	) => Promise<WorkspaceBuild>;
	waitForBuild: (build: WorkspaceBuild) => Promise<ProvisionerJob | undefined>;
}

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

function templateParameter(
	overrides: Partial<TemplateVersionParameter> = {},
): TemplateVersionParameter {
	return {
		name: "parameter",
		description: "",
		description_plaintext: "",
		type: "string",
		form_type: "",
		mutable: true,
		default_value: "default",
		icon: "",
		options: [],
		required: false,
		ephemeral: false,
		...overrides,
	};
}

function parameterOption(
	value: string,
	overrides: Partial<TemplateVersionParameterOption> = {},
): TemplateVersionParameterOption {
	return {
		name: value,
		description: "",
		value,
		icon: "",
		...overrides,
	};
}

function createBuild(
	workspace: Workspace,
	overrides: Partial<WorkspaceBuild> = {},
): WorkspaceBuild {
	return {
		...workspace.latest_build,
		...overrides,
	};
}

function succeededJob(workspace: Workspace): ProvisionerJob {
	return { ...workspace.latest_build.job, status: "succeeded" };
}

function setupUpdateWorkspace({
	workspace = createWorkspace({
		outdated: true,
		template_use_classic_parameter_flow: true,
		latest_build: { status: "stopped", transition: "stop" },
	}),
	finalWorkspace = createWorkspace({
		outdated: false,
		template_use_classic_parameter_flow: true,
		latest_build: { status: "running" },
	}),
	oldBuildParameters = [],
	templateParameters = [],
	featureSetOverrides = {},
}: {
	workspace?: Workspace;
	finalWorkspace?: Workspace;
	oldBuildParameters?: WorkspaceBuildParameter[];
	templateParameters?: TemplateVersionParameter[];
	featureSetOverrides?: Partial<FeatureSet>;
} = {}) {
	const stopBuild = createBuild(workspace, {
		id: "stop-build",
		build_number: 2,
		transition: "stop",
		status: "stopped",
	});
	const startBuild = createBuild(workspace, {
		id: "start-build",
		build_number: 3,
		transition: "start",
		status: "running",
	});
	const postWorkspaceBuild = vi
		.fn<
			(
				workspaceId: string,
				data: CreateWorkspaceBuildRequest,
			) => Promise<WorkspaceBuild>
		>()
		.mockResolvedValueOnce(stopBuild)
		.mockResolvedValue(startBuild);
	const waitForBuild = vi
		.fn<(build: WorkspaceBuild) => Promise<ProvisionerJob | undefined>>()
		.mockResolvedValue(succeededJob(workspace));
	const restClient: UpdateRestClient = {
		getWorkspace: vi
			.fn<(workspaceId: string) => Promise<Workspace>>()
			.mockResolvedValueOnce(workspace)
			.mockResolvedValue(finalWorkspace),
		getWorkspaceBuildParameters: vi
			.fn<(workspaceBuildId: string) => Promise<WorkspaceBuildParameter[]>>()
			.mockResolvedValue(oldBuildParameters),
		getTemplateVersionRichParameters: vi
			.fn<(versionId: string) => Promise<TemplateVersionParameter[]>>()
			.mockResolvedValue(templateParameters),
		getDynamicParameters: vi
			.fn<
				(
					templateVersionId: string,
					ownerId: string,
					oldBuildParameters: WorkspaceBuildParameter[],
				) => Promise<TemplateVersionParameter[]>
			>()
			.mockResolvedValue(templateParameters),
		postWorkspaceBuild,
		waitForBuild,
	};
	const write = vi.fn<(data: string) => void>();
	const ctx: UpdateWorkspaceContext = {
		restClient: restClient as Api,
		auth: { mode: "url", url: "https://test.coder.com" },
		binPath: "/usr/bin/coder",
		workspace,
		write,
		featureSet: { ...featureSet, ...featureSetOverrides },
	};
	return { ctx, restClient, startBuild, stopBuild, write };
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
	it("returns the fresh workspace without building when already up to date", async () => {
		const workspace = createWorkspace({ outdated: false });
		const { ctx, restClient, write } = setupUpdateWorkspace({ workspace });

		await expect(updateWorkspace(ctx)).resolves.toBe(workspace);

		expect(write).toHaveBeenCalledWith("Workspace is up-to-date.\r\n");
		expect(restClient.getWorkspaceBuildParameters).not.toHaveBeenCalled();
		expect(restClient.postWorkspaceBuild).not.toHaveBeenCalled();
		expect(restClient.waitForBuild).not.toHaveBeenCalled();
	});

	it("stops a started workspace before starting the update build", async () => {
		const workspace = createWorkspace({
			outdated: true,
			template_active_version_id: "active-version",
			template_use_classic_parameter_flow: true,
			latest_build: { status: "running", transition: "start" },
		});
		const finalWorkspace = createWorkspace({
			outdated: false,
			template_active_version_id: "active-version",
			latest_build: {
				status: "running",
				template_version_id: "active-version",
			},
		});
		const oldBuildParameters = [{ name: "region", value: "us" }];
		const templateParameters = [
			templateParameter({ name: "region", default_value: "eu" }),
		];
		const { ctx, restClient, startBuild, stopBuild } = setupUpdateWorkspace({
			workspace,
			finalWorkspace,
			oldBuildParameters,
			templateParameters,
		});

		await expect(updateWorkspace(ctx)).resolves.toBe(finalWorkspace);

		expect(restClient.getWorkspace).toHaveBeenNthCalledWith(1, workspace.id);
		expect(restClient.getWorkspaceBuildParameters).toHaveBeenCalledWith(
			workspace.latest_build.id,
		);
		expect(restClient.getTemplateVersionRichParameters).toHaveBeenCalledWith(
			"active-version",
		);
		expect(restClient.postWorkspaceBuild).toHaveBeenNthCalledWith(
			1,
			workspace.id,
			{ transition: "stop", reason: "vscode_connection" },
		);
		expect(restClient.postWorkspaceBuild).toHaveBeenNthCalledWith(
			2,
			workspace.id,
			{
				transition: "start",
				template_version_id: "active-version",
				rich_parameter_values: oldBuildParameters,
				reason: "vscode_connection",
			},
		);
		expect(restClient.waitForBuild).toHaveBeenNthCalledWith(1, stopBuild);
		expect(restClient.waitForBuild).toHaveBeenNthCalledWith(2, startBuild);
	});

	it("evaluates dynamic parameters when the template uses dynamic parameter flow", async () => {
		const workspace = createWorkspace({
			outdated: true,
			template_active_version_id: "active-version",
			template_use_classic_parameter_flow: false,
			latest_build: { status: "stopped", transition: "stop" },
		});
		const oldBuildParameters = [{ name: "region", value: "us" }];
		const { ctx, restClient } = setupUpdateWorkspace({
			workspace,
			oldBuildParameters,
			templateParameters: [templateParameter({ name: "region" })],
		});

		await updateWorkspace(ctx);

		expect(restClient.getDynamicParameters).toHaveBeenCalledWith(
			"active-version",
			workspace.owner_id,
			oldBuildParameters,
		);
		expect(restClient.getTemplateVersionRichParameters).not.toHaveBeenCalled();
	});

	it("uses template defaults for missing optional parameters", async () => {
		const { ctx, restClient } = setupUpdateWorkspace({
			templateParameters: [
				templateParameter({ name: "editor", default_value: "vim" }),
			],
		});

		await updateWorkspace(ctx);

		expect(restClient.postWorkspaceBuild).toHaveBeenCalledWith(
			ctx.workspace.id,
			expect.objectContaining({
				rich_parameter_values: [{ name: "editor", value: "vim" }],
			}),
		);
	});

	it("falls back to the template default when an old option value is invalid", async () => {
		const { ctx, restClient } = setupUpdateWorkspace({
			oldBuildParameters: [{ name: "color", value: "blue" }],
			templateParameters: [
				templateParameter({
					name: "color",
					default_value: "red",
					options: [parameterOption("red"), parameterOption("green")],
				}),
			],
		});

		await updateWorkspace(ctx);

		expect(restClient.postWorkspaceBuild).toHaveBeenCalledWith(
			ctx.workspace.id,
			expect.objectContaining({
				rich_parameter_values: [{ name: "color", value: "red" }],
			}),
		);
	});

	it("preserves valid multi-select values", async () => {
		const oldBuildParameters = [
			{ name: "tools", value: JSON.stringify(["vim", "emacs"]) },
		];
		const { ctx, restClient } = setupUpdateWorkspace({
			oldBuildParameters,
			templateParameters: [
				templateParameter({
					name: "tools",
					type: "list(string)",
					default_value: JSON.stringify(["vim"]),
					options: [parameterOption("vim"), parameterOption("emacs")],
				}),
			],
		});

		await updateWorkspace(ctx);

		expect(restClient.postWorkspaceBuild).toHaveBeenCalledWith(
			ctx.workspace.id,
			expect.objectContaining({ rich_parameter_values: oldBuildParameters }),
		);
	});

	it("omits ephemeral and previously-set immutable parameters", async () => {
		const { ctx, restClient } = setupUpdateWorkspace({
			oldBuildParameters: [
				{ name: "token", value: "secret" },
				{ name: "size", value: "large" },
			],
			templateParameters: [
				templateParameter({ name: "token", ephemeral: true }),
				templateParameter({
					name: "size",
					mutable: false,
					default_value: "small",
				}),
			],
		});

		await updateWorkspace(ctx);

		expect(restClient.postWorkspaceBuild).toHaveBeenCalledWith(
			ctx.workspace.id,
			expect.objectContaining({ rich_parameter_values: [] }),
		);
	});

	it("throws before stopping when a required parameter has no default", async () => {
		const workspace = createWorkspace({
			outdated: true,
			template_use_classic_parameter_flow: true,
			latest_build: { status: "running", transition: "start" },
		});
		const { ctx, restClient } = setupUpdateWorkspace({
			workspace,
			templateParameters: [
				templateParameter({
					name: "project",
					required: true,
					default_value: "",
				}),
			],
		});

		await expect(updateWorkspace(ctx)).rejects.toThrow('parameter "project"');
		expect(restClient.postWorkspaceBuild).not.toHaveBeenCalled();
		expect(restClient.waitForBuild).not.toHaveBeenCalled();
	});

	it("omits build reasons when unsupported by the server", async () => {
		const { ctx, restClient } = setupUpdateWorkspace({
			templateParameters: [templateParameter({ name: "region" })],
			featureSetOverrides: { buildReason: false },
		});

		await updateWorkspace(ctx);

		const request = vi.mocked(restClient.postWorkspaceBuild).mock.calls[0][1];
		expect(request).not.toHaveProperty("reason");
	});
});
