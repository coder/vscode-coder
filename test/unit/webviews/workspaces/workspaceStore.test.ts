import { describe, expect, it, onTestFinished, vi } from "vitest";

import { WorkspaceStore } from "@/webviews/workspaces/workspaceStore";

import {
	agent,
	agentMetadata,
	REPORTED_METADATA,
	workspace,
} from "@repo/mocks";

import {
	createAxiosError,
	createMockLogger,
	MockWorkspacesClient,
	TEST_DEPLOYMENT,
	TestSessionStore,
	userWithRoles,
} from "../../../mocks/testHelpers";

import type { Workspace, WorkspacesState } from "@repo/shared";

/** The 400 a deployment answers with when it cannot run a filter's query. */
const queryRejected = () => createAxiosError(400, "invalid query");

const withAgent = () =>
	workspace({ id: "workspace-1", agents: [agent({ id: "agent-1" })] });

const ids = (state?: WorkspacesState) => state?.workspaces.map((w) => w.id);

function setup() {
	const client = new MockWorkspacesClient();
	const session = new TestSessionStore();
	const store = new WorkspaceStore(client, createMockLogger(), session);
	onTestFinished(() => store.dispose());
	const states: WorkspacesState[] = [];
	store.onDidChange((state) => states.push(state));
	return {
		client,
		session,
		store,
		states,
		last: () => states.at(-1),
		/** Answer the next lists with `responses`, then reveal the store. */
		show: (...responses: Workspace[][]) => {
			responses.forEach((listed) => client.respondOnce(listed));
			return store.setVisible(true);
		},
	};
}

type Store = ReturnType<typeof setup>;

async function shown(...responses: Workspace[][]) {
	const h = setup();
	await h.show(...responses);
	return h;
}

async function watchingAgent() {
	const h = await shown([withAgent()]);
	await h.store.watchAgents(["agent-1"]);
	return h;
}

const pushMetadata = (h: Store) =>
	h.client.metadataStream("agent-1").pushMessage({ data: [agentMetadata()] });

describe("WorkspaceStore", () => {
	it("lists the signed-in user's workspaces once visible", async () => {
		const h = setup();
		await h.store.settled;
		expect(h.states).toEqual([]);
		expect(h.store.state.status).toEqual({ kind: "loading" });

		await h.show([workspace({ id: "workspace-1" })]);
		expect(h.client.getWorkspaces).toHaveBeenCalledWith({ q: "owner:me" });
		expect(h.states).toEqual([
			{
				capabilities: { authenticated: true, filters: ["mine", "shared"] },
				filter: "mine",
				workspaces: [expect.objectContaining({ id: "workspace-1" })],
				status: { kind: "ready" },
				metadata: {},
			},
		]);
		expect(h.store.findWorkspace("workspace-1")).toBeDefined();
		expect(h.store.findWorkspace("gone")).toBeUndefined();
	});

	it("polls the filters that poll, saying nothing when nothing changed", async () => {
		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const second = () => [workspace({ id: "second" })];
		const h = await shown([workspace({ id: "first" })], second(), second());

		await vi.advanceTimersByTimeAsync(5_000);
		expect(h.states.map(ids)).toEqual([["first"], ["second"]]);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(h.states).toHaveLength(2);

		await h.store.setFilter("shared");
		const fetches = h.client.getWorkspaces.mock.calls.length;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(h.client.getWorkspaces).toHaveBeenCalledTimes(fetches);
	});

	interface LoadingCase {
		name: string;
		act: (h: Store) => Promise<void>;
	}

	it.each<LoadingCase>([
		{ name: "a filter switch", act: (h) => h.store.setFilter("shared") },
		{ name: "a refresh", act: (h) => h.store.refresh() },
	])("reports loading again for $name", async ({ act }) => {
		const h = await shown();
		await act(h);
		expect(h.states.map((s) => s.status.kind)).toEqual([
			"ready",
			"loading",
			"ready",
		]);
	});

	it("lists the filter the webview selected, ignoring ones it does not offer", async () => {
		const h = await shown();
		await h.store.setFilter("all");
		expect(h.client.getWorkspaces).toHaveBeenCalledTimes(1);

		await h.store.setFilter("shared");
		expect(h.client.getWorkspaces).toHaveBeenLastCalledWith({
			q: "shared_with_user:current-user",
		});
		expect(h.last()?.filter).toBe("shared");
	});

	it("starts over for each session, offering the filters of whoever signed in", async () => {
		const h = await shown();
		h.session.signIn(TEST_DEPLOYMENT, userWithRoles("owner"));
		await h.store.settled;
		expect(h.last()?.capabilities.filters).toEqual(["mine", "shared", "all"]);
		await h.store.setFilter("all");

		h.session.signInAs("someone-else");
		await h.store.settled;
		expect(h.last()).toMatchObject({
			capabilities: { filters: ["mine", "shared"] },
			filter: "mine",
			workspaces: [],
		});

		const fetches = h.client.getWorkspaces.mock.calls.length;
		h.session.signOut();
		await h.store.settled;
		expect(h.client.getWorkspaces).toHaveBeenCalledTimes(fetches);
		expect(h.last()).toMatchObject({
			capabilities: { authenticated: false, filters: [] },
			status: { kind: "ready" },
		});
	});

	describe("failed fetches", () => {
		it("reports a failure, then clears it once a fetch succeeds", async () => {
			const h = await shown([workspace({ id: "workspace-1" })]);
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("network down"));
			await h.store.refresh();
			expect(h.last()).toMatchObject({
				workspaces: [],
				status: { kind: "failed", error: "network down" },
			});

			await h.store.refresh();
			expect(h.last()?.status).toEqual({ kind: "ready" });
		});

		it("stops offering a filter the deployment rejects, until a visible refresh", async () => {
			const h = await shown();
			h.client.getWorkspaces.mockRejectedValueOnce(queryRejected());
			h.client.respondOnce([workspace({ id: "workspace-1" })]);
			await h.store.setFilter("shared");
			// Falls back to a filter that loads instead of leaving a broken one.
			expect(h.last()).toMatchObject({
				capabilities: { filters: ["mine"] },
				filter: "mine",
				workspaces: [expect.objectContaining({ id: "workspace-1" })],
				status: { kind: "ready" },
			});

			await h.store.setVisible(false);
			await h.store.refresh();
			expect(h.store.state.capabilities.filters).toEqual(["mine"]);

			await h.store.setVisible(true);
			await h.store.refresh();
			expect(h.store.state.capabilities.filters).toEqual(["mine", "shared"]);
		});

		it("keeps the default filter when its query is rejected", async () => {
			const h = setup();
			h.client.getWorkspaces.mockRejectedValueOnce(queryRejected());
			await h.show();
			expect(h.store.state).toMatchObject({
				capabilities: { filters: ["mine", "shared"] },
				status: { kind: "failed", error: "invalid query" },
			});
		});
	});

	describe("agent metadata", () => {
		it("watches the listed agents the webview asks for, and reports what arrives", async () => {
			const h = await shown([withAgent()]);
			expect(h.client.metadataStreams.size).toBe(0);
			await h.store.watchAgents(["agent-1", "not-listed"]);
			expect([...h.client.metadataStreams.keys()]).toEqual(["agent-1"]);

			pushMetadata(h);
			expect(h.last()?.metadata).toEqual({ "agent-1": REPORTED_METADATA });
		});

		it("keeps the sockets and their last report across a hide", async () => {
			const h = await watchingAgent();
			pushMetadata(h);
			const opened = vi.spyOn(h.client, "watchAgentMetadata");
			await h.store.setVisible(false);
			await h.show([withAgent()]);
			expect(opened).not.toHaveBeenCalled();
			expect(h.last()?.metadata).toEqual({ "agent-1": REPORTED_METADATA });
		});

		it("keeps the workspaces when a metadata socket fails", async () => {
			const h = setup();
			vi.spyOn(h.client, "watchAgentMetadata").mockRejectedValue(
				new Error("socket refused"),
			);
			await h.show([withAgent()]);
			await h.store.watchAgents(["agent-1"]);
			expect(h.last()).toMatchObject({
				workspaces: [expect.objectContaining({ id: "workspace-1" })],
				status: { kind: "ready" },
				metadata: {
					"agent-1": {
						kind: "failed",
						error: "Failed to query metadata: socket refused",
					},
				},
			});
		});

		it("releases agents a failed list drops, and closes them once the session ends", async () => {
			const h = await watchingAgent();
			const socket = h.client.metadataStream("agent-1");
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("offline"));
			await h.store.refresh();
			expect(h.store.state.metadata).toEqual({});
			expect(socket.close).not.toHaveBeenCalled();

			h.session.signOut();
			expect(socket.close).toHaveBeenCalledOnce();
		});
	});

	describe("requests that outlive a hide", () => {
		it("caches a response, and keeps it on reveal while the fresh list loads", async () => {
			const h = await shown();
			const pending = h.client.pending();
			const fetching = h.store.refresh();
			void h.store.setVisible(false);
			pending.resolve([workspace({ id: "cached" })]);
			await fetching;
			expect(ids(h.store.state)).toEqual(["cached"]);

			const next = h.client.pending();
			const revealing = h.show();
			expect(h.store.state).toMatchObject({
				workspaces: [expect.objectContaining({ id: "cached" })],
				status: { kind: "ready" },
			});
			next.resolve([]);
			await revealing;
		});

		interface SettleCase {
			name: string;
			settle: (pending: ReturnType<MockWorkspacesClient["pending"]>) => void;
		}

		it.each<SettleCase>([
			{ name: "resolves", settle: (p) => p.resolve([withAgent()]) },
			{ name: "rejects", settle: (p) => p.reject(new Error("old failure")) },
		])("ignores an old session's request when it $name", async ({ settle }) => {
			const h = setup();
			const pending = h.client.pending();
			const fetching = h.show();
			void h.store.setVisible(false);
			h.session.signOut();
			settle(pending);
			await fetching;
			expect(h.store.state).toMatchObject({
				capabilities: { authenticated: false },
				workspaces: [],
				status: { kind: "ready" },
				metadata: {},
			});
		});

		it("invalidates a request when its filter changes", async () => {
			const h = setup();
			const pending = h.client.pending();
			const fetching = h.show();
			void h.store.setVisible(false);
			await h.store.setFilter("shared");
			pending.resolve([withAgent()]);
			await fetching;
			// Nothing lists while hidden, so the new filter is still loading.
			expect(h.store.state).toMatchObject({
				filter: "shared",
				workspaces: [],
				status: { kind: "loading" },
			});
		});
	});
});
