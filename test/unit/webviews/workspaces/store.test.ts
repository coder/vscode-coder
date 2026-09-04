import { afterEach, describe, expect, it, vi } from "vitest";

import { agent, agentMetadata, workspace } from "@repo/mocks";

import { MockEventStream } from "../../../mocks/testHelpers";

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
	describe("lifecycle races", () => {
		it("caches a hidden response without reviving sockets or polling", async () => {
			vi.useFakeTimers();
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			await h.store.setWatchedAgents(["agent-1"]);
			const socket = h.client.metadataStreams.get("agent-1")!;
			const pending = h.client.pending();
			const fetching = h.store.refresh();
			void h.store.setVisible(false);
			pending.resolve([withAgent(), workspace({ id: "cached" })]);
			await fetching;
			expect(ids(h.store.state.workspaces)).toEqual(["workspace-1", "cached"]);
			expect(h.store.state.metadata).toEqual({});
			await h.store.setWatchedAgents(["agent-1"]);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(socket.close).toHaveBeenCalledOnce();
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(2);

			const next = h.client.pending();
			const revealing = h.show();
			expect(ids(h.store.state.workspaces)).toContain("cached");
			expect(h.store.state.workspaces.loading).toBe(false);
			next.resolve([withAgent()]);
			await revealing;
		});

		it("reuses a pending list across rapid hide and reveal", async () => {
			const h = createStore();
			const pending = h.client.pending();
			const first = h.show();
			void h.store.setVisible(false);
			const second = h.show();
			expect(h.client.getWorkspaces).toHaveBeenCalledOnce();
			pending.resolve([withAgent()]);
			await Promise.all([first, second]);
			expect(ids(h.store.state.workspaces)).toEqual(["workspace-1"]);
		});

		it("keeps the pending fetch observable after a hidden refresh", async () => {
			const h = createStore();
			const pending = h.client.pending();
			const fetching = h.show();
			void h.store.setVisible(false);
			const refreshing = h.store.refresh();
			const revealing = h.show();
			expect(refreshing).toBe(fetching);
			expect(revealing).toBe(fetching);
			expect(h.client.getWorkspaces).toHaveBeenCalledOnce();
			pending.resolve([withAgent()]);
			await revealing;
			expect(ids(h.store.state.workspaces)).toEqual(["workspace-1"]);
		});

		it("restores lingering metadata before a reveal fetch completes", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			await h.store.setWatchedAgents(["agent-1"]);
			h.client.metadataStreams
				.get("agent-1")!
				.pushMessage({ data: [agentMetadata()] });
			await h.store.setVisible(false);
			const pending = h.client.pending();
			const revealing = h.show();
			expect(h.store.state.metadata["agent-1"].metadata).toEqual([
				agentMetadata(),
			]);
			pending.resolve([withAgent()]);
			await revealing;
		});

		it.each(["resolve", "reject"] as const)(
			"ignores an old session's hidden request when it %ss",
			async (outcome) => {
				const h = createStore();
				const pending =
					Promise.withResolvers<
						Awaited<ReturnType<typeof h.client.getWorkspaces>>
					>();
				h.client.getWorkspaces.mockReturnValueOnce(pending.promise);
				const fetching = h.show();
				void h.store.setVisible(false);
				h.session.signOut();
				if (outcome === "resolve")
					pending.resolve({ workspaces: [withAgent()], count: 1 });
				else pending.reject(new Error("old failure"));
				await fetching;
				expect(h.store.state).toMatchObject({
					capabilities: { authenticated: false },
					workspaces: { workspaces: [], loading: false },
					metadata: {},
					error: null,
				});
			},
		);

		it("invalidates a hidden request when its filter changes", async () => {
			const h = createStore();
			const pending = h.client.pending();
			const fetching = h.show();
			void h.store.setVisible(false);
			await h.store.setFilter("shared");
			pending.resolve([withAgent()]);
			await fetching;
			expect(h.store.state.workspaces).toEqual({
				filter: "shared",
				workspaces: [],
				loading: false,
			});
			const next = h.client.pending();
			const revealing = h.show();
			expect(h.store.state.workspaces.loading).toBe(true);
			next.resolve([]);
			await revealing;
		});

		it.each([true, false])(
			"closes session sockets immediately when visible is %s",
			async (visible) => {
				const h = createStore();
				h.client.respondOnce([withAgent()]);
				await h.show();
				await h.store.setWatchedAgents(["agent-1"]);
				const socket = h.client.metadataStreams.get("agent-1")!;
				socket.pushMessage({ data: [agentMetadata()] });
				await h.store.setVisible(visible);
				h.session.signOut();
				expect(socket.close).toHaveBeenCalledOnce();
				expect(h.store.state.metadata).toEqual({});
				socket.pushMessage({ data: [agentMetadata()] });
				expect(h.store.state.metadata).toEqual({});
			},
		);

		it("drops sockets opening across a deployment switch", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			const pending =
				Promise.withResolvers<
					Awaited<ReturnType<typeof h.client.watchAgentMetadata>>
				>();
			vi.spyOn(h.client, "watchAgentMetadata").mockReturnValueOnce(
				pending.promise,
			);
			const watching = h.store.setWatchedAgents(["agent-1"]);
			h.session.signIn(
				{ url: "https://other.example.com", safeHostname: "other.example.com" },
				OWNER,
			);
			const socket = new MockEventStream<{
				data: Array<ReturnType<typeof agentMetadata>>;
			}>();
			pending.resolve(socket);
			await watching;
			await h.store.settled;
			expect(socket.close).toHaveBeenCalledOnce();
			expect(h.store.state.metadata).toEqual({});
		});

		it("releases metadata when a list fails", async () => {
			const h = createStore();
			h.client.respondOnce([withAgent()]);
			await h.show();
			await h.store.setWatchedAgents(["agent-1"]);
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("offline"));
			await h.store.refresh();
			expect(h.store.state.metadata).toEqual({});
		});

		it("keeps polling while metadata is still opening", async () => {
			vi.useFakeTimers();
			const h = createStore();
			h.client.getWorkspaces.mockResolvedValue({
				workspaces: [withAgent()],
				count: 1,
			});
			await h.show();
			const pending =
				Promise.withResolvers<
					Awaited<ReturnType<typeof h.client.watchAgentMetadata>>
				>();
			const opened = vi
				.spyOn(h.client, "watchAgentMetadata")
				.mockReturnValueOnce(pending.promise);
			const watching = h.store.setWatchedAgents(["agent-1"]);
			await vi.advanceTimersByTimeAsync(15_000);
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(4);
			expect(opened).toHaveBeenCalledOnce();
			pending.resolve(
				new MockEventStream<{
					data: Array<ReturnType<typeof agentMetadata>>;
				}>(),
			);
			await watching;
		});

		it("resets backoff after a successful non-polling fetch", async () => {
			vi.useFakeTimers();
			const h = createStore({ intervalMs: 100, maxIntervalMs: 1000 });
			await h.show();
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("offline"));
			await h.store.setFilter("shared");
			await vi.advanceTimersByTimeAsync(200);
			h.client.getWorkspaces.mockRejectedValueOnce(new Error("offline again"));
			await h.store.refresh();
			const calls = h.client.getWorkspaces.mock.calls.length;
			await vi.advanceTimersByTimeAsync(200);
			expect(h.client.getWorkspaces).toHaveBeenCalledTimes(calls + 1);
		});
	});
});
