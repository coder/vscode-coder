import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	WorkspaceProvider,
	WorkspaceQuery,
	type AgentTreeItem,
	type WorkspaceTreeItem,
} from "@/workspace/workspacesProvider";

import { agent, resource, workspace } from "@repo/mocks";

import {
	createMockLogger,
	flush,
	flushPromises,
	MockWorkspaceSessionState,
	MockWorkspacesClient,
	TEST_CURRENT_USER_ID,
} from "../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
	WorkspaceAppStatus,
} from "coder/site/src/api/typesGenerated";

import type { AgentMetadataEvent } from "@/api/api-helper";
import type { CoderApi } from "@/api/coderApi";

function setup() {
	const logger = createMockLogger();
	const client = new MockWorkspacesClient();
	const session = new MockWorkspaceSessionState();
	const makeProvider = (
		query: WorkspaceQuery,
		options?: { refreshIntervalMs?: number },
	): WorkspaceProvider =>
		new WorkspaceProvider(
			query,
			client as unknown as CoderApi,
			logger,
			session,
			options,
		);
	return { logger, client, session, makeProvider };
}

function workspaceWithAgents(
	workspaceOverrides: Parameters<typeof workspace>[0] = {},
	agents: WorkspaceAgent[],
): Workspace {
	return workspace({
		...workspaceOverrides,
		latest_build: {
			...workspaceOverrides.latest_build,
			resources: [resource({ agents })],
		},
	});
}

function appStatus(
	overrides: Partial<WorkspaceAppStatus> = {},
): WorkspaceAppStatus {
	return {
		id: "status-1",
		created_at: "2024-01-01T00:00:00Z",
		workspace_id: "workspace-1",
		agent_id: "agent-1",
		app_id: "app-1",
		state: "working",
		message: "Opening pull request",
		uri: "https://example.com/pr/1",
		icon: "",
		needs_user_attention: false,
		...overrides,
	};
}

function app(overrides: Partial<WorkspaceApp> = {}): WorkspaceApp {
	return {
		id: "app-1",
		external: false,
		slug: "app",
		subdomain: false,
		sharing_level: "owner",
		health: "healthy",
		hidden: false,
		open_in: "tab",
		statuses: [],
		...overrides,
	};
}

function metadata(
	overrides: Partial<AgentMetadataEvent> = {},
): AgentMetadataEvent {
	return {
		result: {
			collected_at: "2024-01-01T00:00:00Z",
			age: 0,
			value: "42",
			error: "",
		},
		description: {
			display_name: "CPU",
			key: "cpu",
			script: "cpu.sh",
			interval: 5,
			timeout: 1,
		},
		...overrides,
	};
}

async function show(provider: WorkspaceProvider): Promise<void> {
	provider.setVisibility(true);
	await flush();
}

async function labels(provider: WorkspaceProvider): Promise<unknown[]> {
	return (await provider.getChildren()).map((item) => item.label);
}

describe("WorkspaceProvider", () => {
	it("does not fetch while signed out", async () => {
		const { client, session, makeProvider } = setup();
		session.signOut();
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);

		expect(client.getWorkspaces).not.toHaveBeenCalled();
		expect(await provider.getChildren()).toEqual([]);
	});

	it.each([
		[WorkspaceQuery.Mine, "owner:me"],
		[WorkspaceQuery.Shared, "shared:true"],
		[WorkspaceQuery.All, ""],
	])("fetches %s with the expected query", async (query, expectedQuery) => {
		const { client, makeProvider } = setup();
		const provider = makeProvider(query);

		await show(provider);

		expect(client.getWorkspaces).toHaveBeenCalledWith({ q: expectedQuery });
	});

	it.each([
		{
			query: WorkspaceQuery.Mine,
			label: "dev",
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
		},
		{
			query: WorkspaceQuery.Shared,
			label: "alice / dev",
			collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
		},
		{
			query: WorkspaceQuery.All,
			label: "alice / dev",
			collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
		},
	])(
		"renders top-level workspace items for $query",
		async ({ query, label, collapsibleState }) => {
			const { client, makeProvider } = setup();
			client.respondOnce([
				workspace({
					id: "workspace-1",
					name: "dev",
					owner_id: "alice-id",
					owner_name: "alice",
				}),
			]);
			const provider = makeProvider(query);

			await show(provider);
			const [item] = (await provider.getChildren()) as WorkspaceTreeItem[];

			expect(item?.label).toBe(label);
			expect(item?.description).toBe("running");
			expect(item?.collapsibleState).toBe(collapsibleState);
			expect(item?.contextValue).toContain("running");
		},
	);

	it("filters current-user-owned workspaces from shared results", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([
			workspace({
				id: "owned-shared-out",
				name: "owned",
				owner_id: TEST_CURRENT_USER_ID,
				owner_name: "current",
			}),
			workspace({
				id: "shared-with-me",
				name: "shared",
				owner_id: "alice-id",
				owner_name: "alice",
			}),
		]);
		const provider = makeProvider(WorkspaceQuery.Shared);

		await show(provider);

		expect(await labels(provider)).toEqual(["alice / shared"]);
	});

	it.each([WorkspaceQuery.Mine, WorkspaceQuery.All])(
		"does not apply shared ownership filtering to %s",
		async (query) => {
			const { client, makeProvider } = setup();
			client.respondOnce([
				workspace({
					id: "owned",
					name: "owned",
					owner_id: TEST_CURRENT_USER_ID,
					owner_name: "current",
				}),
			]);
			const provider = makeProvider(query);

			await show(provider);

			expect(await labels(provider)).toHaveLength(1);
		},
	);

	it("clears rendered workspaces when the session signs out", async () => {
		const { client, session, makeProvider } = setup();
		client.respondOnce([workspace({ name: "dev" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);

		session.signOut();
		await flush();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("does not render a pending response after sign-out", async () => {
		const { client, session, makeProvider } = setup();
		const pending = client.pending();
		const provider = makeProvider(WorkspaceQuery.Shared);

		provider.setVisibility(true);
		await flush();
		session.signOut();
		pending.resolve([workspace({ owner_id: "alice-id", owner_name: "alice" })]);
		await flush();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("renders fresh results when the session changes mid-request", async () => {
		const { client, session, makeProvider } = setup();
		const pending = client.pending();
		client.respondOnce([
			workspace({ owner_id: "alice-id", owner_name: "alice", name: "fresh" }),
		]);
		const provider = makeProvider(WorkspaceQuery.Shared);

		provider.setVisibility(true);
		await flush();
		session.signIn("second-user");
		pending.resolve([
			workspace({ owner_id: "bob-id", owner_name: "bob", name: "stale" }),
		]);
		await flush();
		await flush();

		expect(await labels(provider)).toEqual(["alice / fresh"]);
	});

	it("does not fetch while hidden", async () => {
		const { client, makeProvider } = setup();
		const provider = makeProvider(WorkspaceQuery.Mine);

		await provider.fetchAndRefresh();

		expect(client.getWorkspaces).not.toHaveBeenCalled();
	});

	it("renders a response that completes after the tree is hidden", async () => {
		const { client, makeProvider } = setup();
		const pending = client.pending();
		const provider = makeProvider(WorkspaceQuery.Mine);

		provider.setVisibility(true);
		await flush();
		provider.setVisibility(false);
		pending.resolve([workspace({ name: "dev" })]);
		await flush();

		expect(await labels(provider)).toEqual(["dev"]);
	});

	it("renders fresh results for a session change queued while hidden", async () => {
		const { client, session, makeProvider } = setup();
		const pending = client.pending();
		client.respondOnce([workspace({ name: "fresh" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		provider.setVisibility(true);
		await flush();
		provider.setVisibility(false);
		session.signIn("second-user");
		pending.resolve([workspace({ name: "stale" })]);
		await flush();

		provider.setVisibility(true);
		await flush();

		expect(await labels(provider)).toEqual(["fresh"]);
	});

	it("clears the tree when a fetch fails", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([workspace({ name: "dev" })]);
		client.getWorkspaces.mockRejectedValueOnce(new Error("network down"));
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);

		await provider.fetchAndRefresh();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("refreshes content on the polling interval", async () => {
		vi.useFakeTimers();
		try {
			const { client, makeProvider } = setup();
			client.respondOnce([workspace({ name: "first" })]);
			client.respondOnce([workspace({ name: "second" })]);
			const provider = makeProvider(WorkspaceQuery.Mine, {
				refreshIntervalMs: 5_000,
			});

			provider.setVisibility(true);
			await flushPromises();
			expect(await labels(provider)).toEqual(["first"]);

			await vi.advanceTimersByTimeAsync(5_000);
			await flushPromises();

			expect(await labels(provider)).toEqual(["second"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders workspace child agents", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([
			workspaceWithAgents({ name: "dev" }, [
				agent({ id: "agent-1", name: "main", status: "connected" }),
				agent({ id: "agent-2", name: "sidecar", status: "disconnected" }),
			]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		const [workspaceItem] =
			(await provider.getChildren()) as WorkspaceTreeItem[];
		const agentItems = (await provider.getChildren(
			workspaceItem,
		)) as AgentTreeItem[];

		expect(agentItems.map((item) => item.label)).toEqual(["main", "sidecar"]);
		expect(agentItems.map((item) => item.description)).toEqual([
			"connected",
			"disconnected",
		]);
	});

	it("renders app status children for an agent", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([
			workspaceWithAgents({ name: "dev" }, [
				agent({
					id: "agent-1",
					apps: [
						app({
							command: "open-pr",
							statuses: [
								appStatus({ id: "status-1", message: "First" }),
								appStatus({ id: "status-2", message: "Second" }),
							],
						}),
					],
				}),
			]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		const [workspaceItem] =
			(await provider.getChildren()) as WorkspaceTreeItem[];
		const [agentItem] = (await provider.getChildren(
			workspaceItem,
		)) as AgentTreeItem[];
		const [section] = await provider.getChildren(agentItem);
		const statuses = await provider.getChildren(section);

		expect(section?.label).toBe("App Statuses");
		expect(statuses.map((item) => item.description)).toEqual([
			"Second",
			"First",
		]);
		expect(statuses[0]?.command).toMatchObject({
			command: "coder.openAppStatus",
		});
	});

	it("renders agent metadata and surfaces metadata errors", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([
			workspaceWithAgents({ name: "dev" }, [
				agent({ id: "agent-1", name: "main" }),
			]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		const [workspaceItem] =
			(await provider.getChildren()) as WorkspaceTreeItem[];
		const [agentItem] = (await provider.getChildren(
			workspaceItem,
		)) as AgentTreeItem[];
		const stream = client.metadataStreams.get("agent-1")!;

		stream.pushMessage({ data: [metadata()] });
		const [metadataSection] = await provider.getChildren(agentItem);
		const metadataItems = await provider.getChildren(metadataSection);
		expect(metadataSection?.label).toBe("Agent Metadata");
		expect(metadataItems[0]?.label).toBe("CPU: 42");

		stream.pushError(new Error("boom"));
		const [errorSection] = await provider.getChildren(agentItem);
		expect(errorSection?.label).toBe("Failed to query metadata: boom");
	});

	it("empties the tree when cleared", async () => {
		const { client, makeProvider } = setup();
		client.respondOnce([
			workspaceWithAgents({ name: "dev" }, [agent({ id: "agent-1" })]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);

		provider.clear();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("fetches when the session signs in after starting signed out", async () => {
		const { client, session, makeProvider } = setup();
		session.signOut();
		client.respondOnce([workspace({ name: "dev" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(client.getWorkspaces).not.toHaveBeenCalled();

		session.signIn();
		await flush();

		expect(await labels(provider)).toEqual(["dev"]);
	});

	it("stops reacting to session changes after dispose", async () => {
		const { client, session, makeProvider } = setup();
		client.respondOnce([workspace({ name: "dev" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);

		provider.dispose();
		session.signIn("another-user");
		await flush();

		expect(client.getWorkspaces).toHaveBeenCalledTimes(1);
		expect(await provider.getChildren()).toEqual([]);
	});

	it("leaves the tree empty when a fetch fails after a mid-request session change", async () => {
		const { client, session, makeProvider } = setup();
		const pending = client.pending();
		client.getWorkspaces.mockRejectedValueOnce(new Error("network down"));
		const provider = makeProvider(WorkspaceQuery.Mine);

		provider.setVisibility(true);
		await flush();
		session.signIn("second-user");
		pending.resolve([workspace({ name: "stale" })]);
		await flush();
		await flush();

		// Failed retry leaves the tree empty until a manual refresh.
		expect(await provider.getChildren()).toEqual([]);

		// A manual refresh recovers.
		client.respondOnce([workspace({ name: "recovered" })]);
		await provider.fetchAndRefresh();
		expect(await labels(provider)).toEqual(["recovered"]);
	});
});
