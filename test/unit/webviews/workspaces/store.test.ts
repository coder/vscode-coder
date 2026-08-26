import { afterEach, describe, expect, it, vi } from "vitest";

import { agent, agentMetadata, workspace } from "@repo/mocks";

import { createStore, DEPLOYMENT, disposeHarnesses, OWNER } from "./harness";

import type { FilteredWorkspaces } from "@repo/shared";

type Store = ReturnType<typeof createStore>;

function queryRejected(): Error {
	return Object.assign(new Error("invalid query"), {
		isAxiosError: true,
		response: { status: 400 },
	});
}

function ids(listed: FilteredWorkspaces | undefined): string[] {
	return (listed?.workspaces ?? []).map((entry) => entry.id);
}

const withAgent = () =>
	workspace({ id: "workspace-1", agents: [agent({ id: "agent-1" })] });

describe("WorkspaceStore", () => {
	afterEach(() => {
		disposeHarnesses();
		vi.useRealTimers();
	});

	it("lists the workspaces of the signed-in user", async () => {
		const h = createStore();
		h.client.respondOnce([workspace({ id: "workspace-1" })]);

		await h.show();

		expect(h.client.getWorkspaces).toHaveBeenCalledWith({ q: "owner:me" });
		expect(h.last("workspaces")).toEqual({
			filter: "mine",
			workspaces: [expect.objectContaining({ id: "workspace-1" })],
			loading: false,
		} satisfies FilteredWorkspaces);
		expect(h.store.state).toMatchObject({
			capabilities: { authenticated: true, filters: ["mine", "shared"] },
			metadata: {},
			error: null,
		});
		expect(h.store.findWorkspace("workspace-1")?.id).toBe("workspace-1");
		expect(h.store.findWorkspace("gone")).toBeUndefined();
	});

	it("pushes nothing until it is visible", async () => {
		const h = createStore();

		await h.store.settled;

		expect(h.updates).toEqual([]);
	});

	it("reports a signed out session without fetching", async () => {
		const h = createStore();
		h.session.signOut();

		await h.show();

		expect(h.client.getWorkspaces).not.toHaveBeenCalled();
		expect(h.store.state.capabilities).toEqual({
			authenticated: false,
			filters: [],
		});
	});

	describe("polling", () => {
		it("picks up changes on the interval", async () => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 5_000 });
			h.client.respondOnce([workspace({ id: "first" })]);
			h.client.respondOnce([workspace({ id: "second" })]);
			await h.show();

			await vi.advanceTimersByTimeAsync(5_000);

			expect(h.pushes("workspaces").map(ids)).toEqual([
				[],
				["first"],
				["second"],
			]);
		});

		it("says nothing about a poll that changed nothing", async () => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 5_000 });
			h.client.respondOnce([workspace({ id: "workspace-1" })]);
			h.client.respondOnce([workspace({ id: "workspace-1" })]);
			await h.show();
			const pushed = h.updates.length;

			await vi.advanceTimersByTimeAsync(5_000);

			// Not even the loading flag, which would flicker every interval.
			expect(h.updates).toHaveLength(pushed);
		});

		it.each<{ name: string; stop: (h: Store) => void }>([
			{ name: "hidden", stop: (h) => void h.store.setVisible(false) },
			{ name: "disposed", stop: (h) => h.store.dispose() },
		])("stops while $name", async ({ stop }) => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 5_000 });
			h.client.respondOnce([workspace({ id: "first" })]);
			h.client.respondOnce([workspace({ id: "second" })]);
			await h.show();

			stop(h);
			await vi.advanceTimersByTimeAsync(60_000);

			expect(h.pushes("workspaces").map(ids)).toEqual([[], ["first"]]);
		});

		it("only polls filters that are cheap to list", async () => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 5_000 });
			await h.show();
			await h.store.setFilter("shared");
			const listed = h.client.getWorkspaces.mock.calls.length;

			await vi.advanceTimersByTimeAsync(60_000);

			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(listed);
		});

		it("backs off while fetches keep failing, up to a maximum", async () => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 5_000, maxIntervalMs: 20_000 });
			h.client.getWorkspaces.mockRejectedValue(new Error("network down"));
			await h.show();

			// Each retry waits twice as long as the last, then holds at the cap.
			for (const [delay, fetches] of [
				[5_000, 1],
				[5_000, 2],
				[20_000, 3],
				[20_000, 4],
			]) {
				await vi.advanceTimersByTimeAsync(delay);
				expect(h.client.getWorkspaces).toHaveBeenCalledTimes(fetches);
			}
		});
	});

	describe("loading", () => {
		it("reports the list as loading until it arrives", async () => {
			const h = createStore();
			h.client.respondOnce([workspace({ id: "workspace-1" })]);

			await h.show();

			expect(h.pushes("workspaces")).toEqual([
				{ filter: "mine", workspaces: [], loading: true },
				{ filter: "mine", workspaces: [expect.anything()], loading: false },
			]);
		});

		it.each<{ name: string; act: (h: Store) => Promise<void> }>([
			{ name: "a filter switch", act: (h) => h.store.setFilter("shared") },
			{ name: "a deliberate refresh", act: (h) => h.store.refresh() },
		])("reports loading again for $name", async ({ act }) => {
			const h = createStore();
			await h.show();

			await act(h);

			expect(h.pushes("workspaces").map((listed) => listed.loading)).toEqual([
				true,
				false,
				true,
				false,
			]);
		});

		it.each<{ name: string; fail: () => Error }>([
			{ name: "fails", fail: () => new Error("network down") },
			{ name: "is rejected", fail: queryRejected },
		])("stops loading when the fetch $name", async ({ fail }) => {
			const h = createStore();
			await h.show();
			h.client.getWorkspaces.mockRejectedValueOnce(fail());

			await h.store.setFilter("shared");

			expect(h.last("workspaces")?.loading).toBe(false);
		});
	});

	describe("filters", () => {
		it("lists the filter the webview selected", async () => {
			const h = createStore();
			await h.show();

			await h.store.setFilter("shared");

			expect(h.client.getWorkspaces).toHaveBeenLastCalledWith({
				q: "shared_with_user:current-user",
			});
			expect(h.last("workspaces")?.filter).toBe("shared");
		});

		it("offers the filters of whoever signed in", async () => {
			const h = createStore();
			await h.show();
			expect(h.store.state.capabilities.filters).toEqual(["mine", "shared"]);

			h.session.signIn(DEPLOYMENT, OWNER);
			await h.store.settled;

			expect(h.last("capabilities")?.filters).toContain("all");
		});

		it("ignores a filter it does not offer", async () => {
			const h = createStore();
			await h.show();

			await h.store.setFilter("all");

			expect(h.last("workspaces")?.filter).toBe("mine");
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(1);
		});

		it("falls back when the selected filter is no longer offered", async () => {
			const h = createStore();
			h.session.signIn(DEPLOYMENT, OWNER);
			await h.show();
			await h.store.setFilter("all");

			h.session.signInAs("someone-else");
			await h.store.settled;

			expect(h.last("capabilities")?.filters).toEqual(["mine", "shared"]);
			expect(h.last("workspaces")?.filter).toBe("mine");
		});
	});

	describe("session changes", () => {
		it("clears the workspaces and lists them again", async () => {
			const h = createStore();
			h.client.respondOnce([workspace({ id: "workspace-1" })]);
			await h.show();

			h.session.signInAs("someone-else");
			await h.store.settled;

			expect(ids(h.last("workspaces"))).toEqual([]);
			expect(h.last("capabilities")).toMatchObject({ authenticated: true });
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(2);
		});
	});

	describe("failed fetches", () => {
		it("reports a failure, then clears it once a fetch succeeds", async () => {
			const h = createStore();
			h.client.respondOnce([workspace({ id: "workspace-1" })]);
			await h.show();
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("network down"));

			await h.store.refresh();
			expect(h.last("error")).toBe("network down");
			expect(ids(h.last("workspaces"))).toEqual([]);

			await h.store.refresh();

			expect(h.last("error")).toBeNull();
		});

		it("stops offering a filter the deployment rejects", async () => {
			const h = createStore();
			await h.show();
			h.client.getWorkspaces.mockRejectedValueOnce(queryRejected());
			h.client.respondOnce([workspace({ id: "workspace-1" })]);

			await h.store.setFilter("shared");

			expect(h.last("capabilities")?.filters).toEqual(["mine"]);
			// Falls back to a filter that loads instead of leaving a broken one.
			expect(h.last("workspaces")).toMatchObject({
				filter: "mine",
				workspaces: [expect.objectContaining({ id: "workspace-1" })],
			});
			expect(h.last("error")).toBeNull();
		});

		it("keeps the default filter when its query is rejected", async () => {
			const h = createStore();
			h.client.getWorkspaces.mockRejectedValueOnce(queryRejected());

			await h.show();

			expect(h.store.state.capabilities.filters).toEqual(["mine", "shared"]);
			expect(h.last("error")).toBe("invalid query");
		});

		it("offers a rejected filter again on refresh", async () => {
			const h = createStore();
			await h.show();
			h.client.getWorkspaces.mockRejectedValueOnce(queryRejected());
			await h.store.setFilter("shared");

			await h.store.refresh();

			expect(h.last("capabilities")?.filters).toEqual(["mine", "shared"]);
		});
	});

	describe("agent metadata", () => {
		it("watches nothing until the webview asks, then pushes reports", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			expect(h.client.metadataStreams.size).toBe(0);

			// The agent that is not listed is not watched.
			await h.store.setWatchedAgents(["agent-1", "not-listed"]);
			expect([...h.client.metadataStreams.keys()]).toEqual(["agent-1"]);

			h.client.metadataStreams
				.get("agent-1")
				?.pushMessage({ data: [agentMetadata()] });

			expect(h.last("metadata")).toEqual({
				"agent-1": { metadata: [agentMetadata()], error: null, loading: false },
			});
		});

		it("stops reporting what the webview stopped showing", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			await h.store.setWatchedAgents(["agent-1"]);

			await h.store.setWatchedAgents([]);

			expect(h.last("metadata")).toEqual({});
		});

		it("lets go of the sockets while hidden and takes them back on reveal", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			await h.store.setWatchedAgents(["agent-1"]);
			h.client.metadataStreams
				.get("agent-1")
				?.pushMessage({ data: [agentMetadata()] });
			const opened = vi.spyOn(h.client, "watchAgentMetadata");

			await h.store.setVisible(false);
			expect(h.last("metadata")).toEqual({});

			h.client.respondOnce([withAgent()]);
			await h.store.setVisible(true);

			// The socket outlived the hide, so its last report comes straight back.
			expect(opened).not.toHaveBeenCalled();
			expect(h.last("metadata")).toEqual({
				"agent-1": { metadata: [agentMetadata()], error: null, loading: false },
			});
		});

		it("keeps the workspaces when a metadata socket fails", async () => {
			const h = createStore();
			vi.spyOn(h.client, "watchAgentMetadata").mockRejectedValue(
				new Error("socket refused"),
			);
			h.client.respondOnce([withAgent()]);
			await h.show();

			await h.store.setWatchedAgents(["agent-1"]);

			expect(ids(h.last("workspaces"))).toEqual(["workspace-1"]);
			expect(h.last("error")).toBeNull();
			expect(h.last("metadata")).toEqual({
				"agent-1": {
					metadata: [],
					error: "Failed to query metadata: socket refused",
					loading: false,
				},
			});
		});
	});

	describe("under load", () => {
		it("applies only the newest of many overlapping fetches", async () => {
			const h = createStore();
			const fetches = Array.from({ length: 4 }, () => h.client.pending());
			void h.store.setVisible(true);
			for (let i = 1; i < fetches.length; i++) {
				void h.store.refresh();
			}

			// Out of order, with the newest fetch resolving in the middle.
			fetches[2].resolve([workspace({ id: "third" })]);
			fetches[0].resolve([workspace({ id: "first" })]);
			fetches[3].resolve([workspace({ id: "newest" })]);
			fetches[1].resolve([workspace({ id: "second" })]);
			await h.store.settled;

			expect(h.pushes("workspaces").flatMap(ids)).toEqual(["newest"]);
		});

		it("settles on the last of many filter switches", async () => {
			const h = createStore();
			h.session.signIn(DEPLOYMENT, OWNER);
			await h.show();

			void h.store.setFilter("shared");
			void h.store.setFilter("all");
			void h.store.setFilter("mine");
			await h.store.setFilter("shared");

			expect(h.last("workspaces")?.filter).toBe("shared");
			expect(h.client.getWorkspaces).toHaveBeenLastCalledWith({
				q: `shared_with_user:${OWNER.id}`,
			});
		});

		it("watches a large fleet of agents", async () => {
			const h = createStore();
			const workspaces = Array.from({ length: 50 }, (_, i) =>
				workspace({
					id: `workspace-${i}`,
					agents: [agent({ id: `agent-${i}` })],
				}),
			);
			h.client.respondOnce(workspaces);
			await h.show();

			await h.store.setWatchedAgents(workspaces.map((_, i) => `agent-${i}`));

			expect(h.client.metadataStreams.size).toBe(50);
			expect(Object.keys(h.last("metadata") ?? {})).toHaveLength(50);
		});
	});
});
