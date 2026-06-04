import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	WorkspaceProvider,
	WorkspaceQuery,
	type AgentTreeItem,
	type WorkspaceTreeItem,
} from "@/workspace/workspacesProvider";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createMockLogger } from "../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
	WorkspaceAppStatus,
} from "coder/site/src/api/typesGenerated";

import type { AgentMetadataWatcher } from "@/api/agentMetadataHelper";
import type { AgentMetadataEvent } from "@/api/api-helper";
import type { CoderApi } from "@/api/coderApi";
import type { WorkspaceSessionSnapshot } from "@/workspace/session";

vi.mock("@/api/agentMetadataHelper", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/api/agentMetadataHelper")>();
	return {
		...original,
		createAgentMetadataWatcher: vi.fn(),
	};
});

const { createAgentMetadataWatcher } =
	await import("@/api/agentMetadataHelper");

const baseUrl = "https://coder.example.com";
const currentUserId = "current-user";

interface WorkspacesResponse {
	workspaces: readonly Workspace[];
	count: number;
}

class TestClient {
	baseURL: string | undefined = baseUrl;
	readonly getWorkspaces = vi.fn(
		(_req: { q: string }): Promise<WorkspacesResponse> =>
			Promise.resolve({ workspaces: [], count: 0 }),
	);

	getAxiosInstance() {
		return {
			defaults: {
				baseURL: this.baseURL,
			},
		};
	}
}

class TestSessionState {
	private revision = 0;
	private readonly onDidChangeEmitter =
		new vscode.EventEmitter<WorkspaceSessionSnapshot>();
	readonly onDidChange = this.onDidChangeEmitter.event;
	private snapshot: WorkspaceSessionSnapshot = {
		kind: "signedIn",
		revision: this.revision,
		userId: currentUserId,
	};

	getSnapshot(): WorkspaceSessionSnapshot {
		return this.snapshot;
	}

	signIn(userId = currentUserId): void {
		this.revision += 1;
		this.snapshot = { kind: "signedIn", revision: this.revision, userId };
		this.onDidChangeEmitter.fire(this.snapshot);
	}

	signOut(): void {
		this.revision += 1;
		this.snapshot = { kind: "signedOut", revision: this.revision };
		this.onDidChangeEmitter.fire(this.snapshot);
	}
}

type TestWatcher = AgentMetadataWatcher & {
	onChangeEmitter: vscode.EventEmitter<null>;
	dispose: ReturnType<typeof vi.fn<() => void>>;
};

describe("WorkspaceProvider", () => {
	let client: TestClient;
	let logger: ReturnType<typeof createMockLogger>;
	let session: TestSessionState;
	let watchers: TestWatcher[];

	beforeEach(() => {
		client = new TestClient();
		logger = createMockLogger();
		session = new TestSessionState();
		watchers = [];
		vi.mocked(createAgentMetadataWatcher).mockImplementation(() => {
			const onChangeEmitter = new vscode.EventEmitter<null>();
			const watcher: TestWatcher = {
				onChangeEmitter,
				onChange: onChangeEmitter.event,
				dispose: vi.fn<() => void>(),
			};
			watchers.push(watcher);
			return Promise.resolve(watcher);
		});
	});

	function makeProvider(
		query: WorkspaceQuery,
		options?: { refreshIntervalMs?: number },
	): WorkspaceProvider {
		return new WorkspaceProvider(
			query,
			client as unknown as CoderApi,
			logger,
			session,
			options,
		);
	}

	function workspace(
		overrides: Parameters<typeof createWorkspace>[0] = {},
	): Workspace {
		return createWorkspace(overrides);
	}

	function agent(overrides: Partial<WorkspaceAgent> = {}): WorkspaceAgent {
		return createAgent(overrides);
	}

	function workspaceWithAgents(
		workspaceOverrides: Parameters<typeof createWorkspace>[0] = {},
		agents: WorkspaceAgent[],
	): Workspace {
		return workspace({
			...workspaceOverrides,
			latest_build: {
				...workspaceOverrides.latest_build,
				resources: [createResource({ agents })],
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

	function respondOnce(workspaces: readonly Workspace[]): void {
		client.getWorkspaces.mockResolvedValueOnce({
			workspaces,
			count: workspaces.length,
		});
	}

	function pendingWorkspaces(): {
		resolve: (workspaces: readonly Workspace[]) => void;
	} {
		let resolve!: (workspaces: readonly Workspace[]) => void;
		client.getWorkspaces.mockReturnValueOnce(
			new Promise<WorkspacesResponse>((res) => {
				resolve = (workspaces) => res({ workspaces, count: workspaces.length });
			}),
		);
		return { resolve };
	}

	async function flush(): Promise<void> {
		await new Promise((resolve) => setImmediate(resolve));
	}

	async function flushPromises(): Promise<void> {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	}

	async function show(provider: WorkspaceProvider): Promise<void> {
		provider.setVisibility(true);
		await flush();
	}

	async function labels(provider: WorkspaceProvider): Promise<unknown[]> {
		return (await provider.getChildren()).map((item) => item.label);
	}

	it("does not fetch while signed out", async () => {
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
			respondOnce([
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
		respondOnce([
			workspace({
				id: "owned-shared-out",
				name: "owned",
				owner_id: currentUserId,
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
			respondOnce([
				workspace({
					id: "owned",
					name: "owned",
					owner_id: currentUserId,
					owner_name: "current",
				}),
			]);
			const provider = makeProvider(query);

			await show(provider);

			expect(await labels(provider)).toHaveLength(1);
		},
	);

	it("clears rendered workspaces when the session signs out", async () => {
		respondOnce([workspace({ name: "dev" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);

		session.signOut();
		await flush();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("does not render a pending response after sign-out", async () => {
		const pending = pendingWorkspaces();
		const provider = makeProvider(WorkspaceQuery.Shared);

		provider.setVisibility(true);
		await flush();
		session.signOut();
		pending.resolve([workspace({ owner_id: "alice-id", owner_name: "alice" })]);
		await flush();

		expect(await provider.getChildren()).toEqual([]);
	});

	it("refetches when the session changes while a request is pending", async () => {
		const pending = pendingWorkspaces();
		client.getWorkspaces.mockResolvedValueOnce({
			workspaces: [
				workspace({
					id: "fresh-workspace",
					owner_id: "alice-id",
					owner_name: "alice",
					name: "fresh",
				}),
			],
			count: 1,
		});
		const provider = makeProvider(WorkspaceQuery.Shared);

		provider.setVisibility(true);
		await flush();
		session.signIn("second-user");
		pending.resolve([
			workspace({
				id: "stale-workspace",
				owner_id: "bob-id",
				owner_name: "bob",
				name: "stale",
			}),
		]);
		await flush();
		await flush();

		expect(client.getWorkspaces).toHaveBeenCalledTimes(2);
		expect(await labels(provider)).toEqual(["alice / fresh"]);
	});

	it("does not fetch while hidden", async () => {
		const provider = makeProvider(WorkspaceQuery.Mine);

		await provider.fetchAndRefresh();

		expect(client.getWorkspaces).not.toHaveBeenCalled();
	});

	it("renders a response that completes after the tree is hidden", async () => {
		const pending = pendingWorkspaces();
		const provider = makeProvider(WorkspaceQuery.Mine);

		provider.setVisibility(true);
		await flush();
		provider.setVisibility(false);
		pending.resolve([workspace({ name: "dev" })]);
		await flush();

		expect(await labels(provider)).toEqual(["dev"]);
	});

	it("fetches queued session changes when the tree is shown again", async () => {
		const pending = pendingWorkspaces();
		respondOnce([workspace({ name: "fresh", owner_id: "alice-id" })]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		provider.setVisibility(true);
		await flush();
		provider.setVisibility(false);
		session.signIn("second-user");
		pending.resolve([workspace({ name: "stale" })]);
		await flush();

		provider.setVisibility(true);
		await flush();

		expect(client.getWorkspaces).toHaveBeenCalledTimes(2);
		expect(await labels(provider)).toEqual(["fresh"]);
	});

	it("clears and logs when fetch fails", async () => {
		respondOnce([workspace({ name: "dev" })]);
		client.getWorkspaces.mockRejectedValueOnce(new Error("network down"));
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(await labels(provider)).toEqual(["dev"]);
		await provider.fetchAndRefresh();

		expect(await provider.getChildren()).toEqual([]);
		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to fetch workspaces:",
			expect.any(Error),
		);
	});

	it("schedules polling after a successful refresh", async () => {
		vi.useFakeTimers();
		try {
			respondOnce([workspace({ name: "first" })]);
			respondOnce([workspace({ name: "second" })]);
			const provider = makeProvider(WorkspaceQuery.Mine, {
				refreshIntervalMs: 5_000,
			});

			provider.setVisibility(true);
			await flushPromises();
			expect(await labels(provider)).toEqual(["first"]);

			await vi.advanceTimersByTimeAsync(5_000);
			await flushPromises();

			expect(client.getWorkspaces).toHaveBeenCalledTimes(2);
			expect(await labels(provider)).toEqual(["second"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders workspace child agents", async () => {
		respondOnce([
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
		respondOnce([
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

	it("renders metadata and metadata errors for watched agents", async () => {
		respondOnce([
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

		watchers[0].metadata = [metadata()];
		let [section] = await provider.getChildren(agentItem);
		const metadataItems = await provider.getChildren(section);
		expect(section?.label).toBe("Agent Metadata");
		expect(metadataItems[0]?.label).toBe("CPU: 42");

		watchers[0].error = new Error("boom");
		[section] = await provider.getChildren(agentItem);
		expect(section?.label).toBe("Failed to query metadata: boom");
	});

	it("reuses and disposes metadata watchers as agents change", async () => {
		respondOnce([
			workspaceWithAgents({ name: "dev" }, [agent({ id: "agent-1" })]),
		]);
		respondOnce([
			workspaceWithAgents({ name: "dev" }, [agent({ id: "agent-2" })]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		expect(vi.mocked(createAgentMetadataWatcher)).toHaveBeenCalledWith(
			"agent-1",
			client,
		);

		await provider.fetchAndRefresh();
		await flush();

		expect(watchers[0].dispose).toHaveBeenCalled();
		expect(vi.mocked(createAgentMetadataWatcher)).toHaveBeenCalledWith(
			"agent-2",
			client,
		);
	});

	it("clear removes workspaces and disposes metadata watchers", async () => {
		respondOnce([
			workspaceWithAgents({ name: "dev" }, [agent({ id: "agent-1" })]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);

		await show(provider);
		provider.clear();

		expect(await provider.getChildren()).toEqual([]);
		expect(watchers[0].dispose).toHaveBeenCalled();
	});

	it("dispose removes metadata watchers without firing a tree refresh", async () => {
		respondOnce([
			workspaceWithAgents({ name: "dev" }, [agent({ id: "agent-1" })]),
		]);
		const provider = makeProvider(WorkspaceQuery.Mine);
		const onDidChangeTreeData = vi.fn();

		await show(provider);
		provider.onDidChangeTreeData(onDidChangeTreeData);
		provider.dispose();

		expect(watchers[0].dispose).toHaveBeenCalled();
		expect(onDidChangeTreeData).not.toHaveBeenCalled();
	});
});
