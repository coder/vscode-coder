import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import { WorkspacesPanelProvider } from "@/webviews/workspaces/panelProvider";
import { WorkspaceStore } from "@/webviews/workspaces/workspaceStore";

import {
	agent,
	agentMetadata,
	PENDING_METADATA,
	REPORTED_METADATA,
	workspace,
} from "@repo/mocks";
import {
	WorkspacesApi,
	type CommandDef,
	type OpenWorkspaceParams,
	type WorkspacesState,
} from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewView,
	flushPromises,
	MockCancellationToken,
	MockConfigurationProvider,
	MockWorkspacesClient,
	TestSessionStore,
} from "../../../mocks/testHelpers";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { Commands } from "@/commands";

const alice = () =>
	workspace({
		id: "workspace-1",
		name: "dev",
		owner_name: "alice",
		agents: [agent({ id: "agent-1", name: "main" })],
	});

const isState = (m: unknown): m is { data: WorkspacesState } =>
	(m as { type?: string }).type === WorkspacesApi.stateChanged.method;

/** Each state as `[status, workspace ids]`, so a list is easy to read. */
const listings = (states: WorkspacesState[]) =>
	states.map((s) => [s.status.kind, s.workspaces.map((w) => w.id)]);

function setup() {
	vi.clearAllMocks();
	new MockConfigurationProvider();
	const client = new MockWorkspacesClient();
	const store = new WorkspaceStore(
		client,
		createMockLogger(),
		new TestSessionStore(),
	);
	const commands = {
		openWorkspaceFromSidebar: vi.fn(() => Promise.resolve()),
		openWorkspaceInDashboard: vi.fn(() => Promise.resolve()),
	} satisfies Pick<
		Commands,
		"openWorkspaceFromSidebar" | "openWorkspaceInDashboard"
	>;
	const provider = new WorkspacesPanelProvider(
		vscode.Uri.file("/test"),
		store,
		commands,
		createMockLogger(),
	);
	onTestFinished(() => {
		provider.dispose();
		store.dispose();
	});

	/** Resolve a view, as VS Code does when the panel is (re)opened. */
	const resolveView = (
		options: { cancelled?: boolean; visible?: boolean } = {},
	) => {
		const { view, hooks } = createMockWebviewView(
			WorkspacesPanelProvider.viewType,
			options,
		);
		provider.resolveWebviewView(
			view,
			{} as vscode.WebviewViewResolveContext,
			new MockCancellationToken(options.cancelled),
		);
		return {
			view,
			hooks,
			/** Send a command from the webview and wait for its handler. */
			send: async <P>(
				def: CommandDef<P>,
				...args: P extends void ? [] : [params: P]
			) => {
				hooks.sendFromWebview({ method: def.method, params: args[0] });
				await flushPromises();
				await store.settled;
			},
			pushed: (): WorkspacesState[] =>
				hooks.postedMessages.filter(isState).map(({ data }) => data),
		};
	};

	return { client, store, commands, provider, resolveView, ...resolveView() };
}

/** A visible panel, answering its first lists with `responses`, in order. */
async function shown(...responses: Workspace[][]) {
	const h = setup();
	responses.forEach((listed) => h.client.respondOnce(listed));
	h.hooks.setVisible(true);
	await h.store.settled;
	h.hooks.clearPostedMessages();
	return h;
}

type Panel = Awaited<ReturnType<typeof shown>>;

describe("WorkspacesPanelProvider", () => {
	it("renders the bundle, and answers ready with the state it has", async () => {
		const h = await shown([alice()]);
		expect(h.view.webview.html).toContain("Coder Workspaces");
		await h.send(WorkspacesApi.ready);
		expect(listings(h.pushed())).toEqual([["ready", ["workspace-1"]]]);
		expect(h.client.getWorkspaces).toHaveBeenCalledTimes(1);
	});

	it("pushes the whole state on every change", async () => {
		const h = await shown();
		h.client.respondOnce([alice()]);
		await h.send(WorkspacesApi.refresh);
		expect(listings(h.pushed())).toEqual([
			["loading", []],
			["ready", ["workspace-1"]],
		]);
	});

	it("pushes only the fresh list on reveal, since the webview kept the rest", async () => {
		const h = await shown();
		h.hooks.setVisible(false);
		h.client.respondOnce([alice()]);
		h.hooks.setVisible(true);
		await h.store.settled;
		expect(listings(h.pushed())).toEqual([["ready", ["workspace-1"]]]);
	});

	it("keeps a hidden webview current", async () => {
		const h = await shown([alice()]);
		await h.send(WorkspacesApi.watchAgents, { agentIds: ["agent-1"] });
		h.hooks.setVisible(false);
		h.hooks.clearPostedMessages();
		h.client.metadataStream("agent-1").pushMessage({ data: [agentMetadata()] });
		expect(h.pushed().map((s) => s.metadata)).toEqual([
			{ "agent-1": REPORTED_METADATA },
		]);
	});

	it("stops watching the agents a webview expanded once it reloads", async () => {
		const h = await shown([alice()]);
		await h.send(WorkspacesApi.watchAgents, { agentIds: ["agent-1"] });
		await h.send(WorkspacesApi.ready);
		expect(h.pushed().at(-1)?.metadata).toEqual({});
		expect(h.store.state.metadata).toEqual({});
	});

	describe("lifecycle", () => {
		interface TeardownCase {
			name: string;
			teardown: (h: Panel) => void;
		}

		it.each<TeardownCase>([
			{
				name: "the provider is disposed",
				teardown: (h) => h.provider.dispose(),
			},
			{ name: "the view is destroyed", teardown: (h) => h.hooks.fireDispose() },
		])("stops listing and pushing when $name", async ({ teardown }) => {
			const h = await shown();
			teardown(h);
			// Only a store that was left hidden lists again when revealed.
			await h.store.setVisible(true);
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(2);
			expect(h.pushed()).toEqual([]);
		});

		it("hands the panel to the newest view, even once the old one is destroyed", async () => {
			const h = await shown();
			const next = h.resolveView();
			await h.send(WorkspacesApi.ready);
			h.hooks.fireDispose();
			await next.send(WorkspacesApi.ready);
			expect(h.pushed()).toEqual([]);
			expect(listings(next.pushed())).toEqual([["ready", []]]);
		});

		it("keeps listing and watching when a visible view replaces another", async () => {
			const h = await shown([alice()]);
			await h.send(WorkspacesApi.watchAgents, { agentIds: ["agent-1"] });
			h.resolveView({ visible: true });
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(1);
			expect(h.store.state.metadata).toEqual({ "agent-1": PENDING_METADATA });
		});

		it("resolves nothing once the request is cancelled", async () => {
			const h = await shown();
			const cancelled = h.resolveView({ cancelled: true });
			expect(cancelled.view.webview.html).toBe("");
			await cancelled.send(WorkspacesApi.ready);
			expect(cancelled.pushed()).toEqual([]);
			await h.send(WorkspacesApi.ready);
			expect(h.pushed()).toHaveLength(1);
		});
	});

	it("ignores an unrecognized message", async () => {
		const h = await shown();
		h.hooks.sendFromWebview({ method: "nope" });
		await flushPromises();
		expect(h.pushed()).toEqual([]);
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	it("forwards commands to the store, and dashboard pages to Commands", async () => {
		const h = await shown([alice()]);
		await h.send(WorkspacesApi.watchAgents, { agentIds: ["agent-1"] });
		expect([...h.client.metadataStreams.keys()]).toEqual(["agent-1"]);

		const params = { workspaceId: "workspace-1", page: "settings" } as const;
		await h.send(WorkspacesApi.viewInDashboard, params);
		expect(h.commands.openWorkspaceInDashboard).toHaveBeenCalledWith(
			expect.objectContaining({ name: "dev" }),
			"settings",
		);

		await h.send(WorkspacesApi.setFilter, { filter: "shared" });
		expect(h.store.state.filter).toBe("shared");
	});

	interface OpenCase {
		name: string;
		params: OpenWorkspaceParams;
		agent?: string;
	}

	it.each<OpenCase>([
		{ name: "the workspace", params: { workspaceId: "workspace-1" } },
		{
			name: "one of its agents",
			params: { workspaceId: "workspace-1", agentId: "agent-1" },
			agent: "main",
		},
	])("opens $name", async ({ params, agent: agentName }) => {
		const h = await shown([alice()]);
		await h.send(WorkspacesApi.openWorkspace, params);
		expect(h.commands.openWorkspaceFromSidebar).toHaveBeenCalledWith(
			expect.objectContaining({ name: "dev", owner_name: "alice" }),
			agentName && expect.objectContaining({ name: agentName }),
		);
	});

	interface FailedOpenCase {
		name: string;
		params: OpenWorkspaceParams;
		reported: string;
	}

	it.each<FailedOpenCase>([
		{
			name: "a workspace that is gone",
			params: { workspaceId: "gone" },
			reported: "Workspace is no longer available",
		},
		{
			name: "an agent that is gone",
			params: { workspaceId: "workspace-1", agentId: "gone" },
			reported: "Agent is no longer available",
		},
		{
			name: "a connection that failed",
			params: { workspaceId: "workspace-1" },
			reported: "no SSH binary",
		},
	])("reports opening $name", async ({ params, reported }) => {
		const h = await shown([alice()]);
		h.commands.openWorkspaceFromSidebar.mockRejectedValueOnce(
			new Error(reported),
		);
		await h.send(WorkspacesApi.openWorkspace, params);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(reported);
	});
});
