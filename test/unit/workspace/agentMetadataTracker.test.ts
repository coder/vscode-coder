import { describe, expect, it, onTestFinished, vi } from "vitest";

import { AgentMetadataTracker } from "@/workspace/agentMetadataTracker";

import {
	agentMetadata,
	PENDING_METADATA,
	REPORTED_METADATA,
} from "@repo/mocks";

import {
	MockEventStream,
	MockWorkspacesClient,
	type MockMetadataStream,
} from "../../mocks/testHelpers";

import type { AgentMetadataMap, AgentMetadataState } from "@repo/shared";

const LINGER_MS = 1_000;

const failed = (cause: string): AgentMetadataState => ({
	kind: "failed",
	error: `Failed to query metadata: ${cause}`,
});

const died = { code: 1006, reason: "", wasClean: false };

/** A tracker watching `agents`, on fake timers, spying on the sockets it opens. */
async function setup(...agents: string[]) {
	vi.useFakeTimers();
	const client = new MockWorkspacesClient();
	const tracker = new AgentMetadataTracker(client, LINGER_MS);
	onTestFinished(() => {
		tracker.dispose();
		vi.useRealTimers();
	});
	const reports: AgentMetadataMap[] = [];
	tracker.onDidChange(() => reports.push(tracker.metadata));
	const opened = vi.spyOn(client, "watchAgentMetadata");
	await tracker.watch(agents);
	return {
		client,
		tracker,
		reports,
		opened,
		stream: client.metadataStream.bind(client),
	};
}

describe("AgentMetadataTracker", () => {
	it("reports the agents it was given, with one socket each", async () => {
		const { opened, tracker, reports } = await setup("agent-1", "agent-2");
		await tracker.watch(["agent-2", "agent-3"]);
		expect(reports).toEqual([
			{ "agent-1": PENDING_METADATA, "agent-2": PENDING_METADATA },
			{ "agent-2": PENDING_METADATA, "agent-3": PENDING_METADATA },
		]);
		expect(opened.mock.calls.map(([id]) => id)).toEqual([
			"agent-1",
			"agent-2",
			"agent-3",
		]);
	});

	interface ReportCase {
		name: string;
		send: (stream: MockMetadataStream) => void;
		reported: AgentMetadataState;
	}

	it.each<ReportCase>([
		{
			name: "metadata",
			send: (stream) => stream.pushMessage({ data: [agentMetadata()] }),
			reported: REPORTED_METADATA,
		},
		{
			name: "a failure",
			send: (stream) => stream.pushError(new Error("boom")),
			reported: failed("boom"),
		},
	])("reports $name an agent sends", async ({ send, reported }) => {
		const { tracker, stream } = await setup("agent-1");
		send(stream("agent-1"));
		expect(tracker.metadata).toEqual({ "agent-1": reported });
	});

	it("keeps a released socket for a while, reporting only what is watched", async () => {
		const { tracker, reports, stream } = await setup("agent-1", "agent-2");
		const released = stream("agent-1");
		await tracker.watch(["agent-2"]);
		expect(reports.at(-1)).toEqual({ "agent-2": PENDING_METADATA });
		expect(released.close).not.toHaveBeenCalled();

		const reported = reports.length;
		released.pushMessage({ data: [agentMetadata()] });
		expect(reports).toHaveLength(reported);

		vi.advanceTimersByTime(LINGER_MS);
		expect(released.close).toHaveBeenCalled();
	});

	it("reuses a lingering socket, with what it already reported", async () => {
		const { opened, tracker, stream } = await setup("agent-1");
		stream("agent-1").pushMessage({ data: [agentMetadata()] });
		for (let i = 0; i < 5; i++) {
			await tracker.watch([]);
			vi.advanceTimersByTime(LINGER_MS / 2);
			await tracker.watch(["agent-1"]);
		}
		expect(opened).toHaveBeenCalledTimes(1);
		expect(tracker.metadata).toEqual({ "agent-1": REPORTED_METADATA });
	});

	it("reports a socket that never opened, and retries it", async () => {
		const { client, opened, tracker } = await setup();
		opened.mockRejectedValueOnce(new Error("socket refused"));
		await tracker.watch(["agent-1"]);
		expect(tracker.metadata).toEqual({ "agent-1": failed("socket refused") });

		await tracker.watch(["agent-1"]);
		expect(client.metadataStreams.has("agent-1")).toBe(true);
	});

	it("reopens a socket that died, ignoring what the old one still says", async () => {
		const { opened, tracker, stream } = await setup("agent-1");
		const old = stream("agent-1");
		old.emit("close", died);
		old.close.mockImplementation(() => old.pushError(new Error("closing")));
		await tracker.watch(["agent-1"]);
		expect(opened).toHaveBeenCalledTimes(2);

		stream("agent-1").pushMessage({ data: [agentMetadata()] });
		old.pushError(new Error("stale"));
		expect(tracker.metadata).toEqual({ "agent-1": REPORTED_METADATA });
	});

	it("clears every socket at once, and closes for good once disposed", async () => {
		const { client, tracker, reports, opened } = await setup(
			"agent-1",
			"agent-2",
		);
		await tracker.watch(["agent-1"]);
		tracker.clear();
		for (const socket of client.metadataStreams.values()) {
			expect(socket.close).toHaveBeenCalledOnce();
		}
		expect(reports.at(-1)).toEqual({});
		await tracker.watch(["agent-1"]);
		expect(opened).toHaveBeenCalledTimes(3);

		const reported = reports.length;
		tracker.dispose();
		client.metadataStream("agent-1").pushMessage({ data: [agentMetadata()] });
		await tracker.watch(["agent-3"]);
		expect(reports).toHaveLength(reported);
		expect(opened).toHaveBeenCalledTimes(3);
	});

	describe("races", () => {
		it("joins overlapping opens for the same agent", async () => {
			const { tracker, opened } = await setup();
			const pending = Promise.withResolvers<MockMetadataStream>();
			opened.mockReturnValueOnce(pending.promise);
			const first = tracker.watch(["agent-1"]);
			const second = tracker.watch(["agent-1"]);
			expect(opened).toHaveBeenCalledOnce();
			pending.resolve(new MockEventStream());
			await Promise.all([first, second]);
		});

		interface StaleOpenCase {
			expiry: string;
			expire: (tracker: AgentMetadataTracker) => void | Promise<void>;
			outcome: "resolves" | "rejects";
		}

		const expiries: Record<string, StaleOpenCase["expire"]> = {
			"lingered out": async (tracker) => {
				await tracker.watch([]);
				vi.advanceTimersByTime(LINGER_MS);
			},
			"was cleared": (tracker) => tracker.clear(),
			"was disposed": (tracker) => tracker.dispose(),
		};

		it.each<StaleOpenCase>(
			Object.entries(expiries).flatMap(([expiry, expire]) => [
				{ expiry, expire, outcome: "resolves" },
				{ expiry, expire, outcome: "rejects" },
			]),
		)(
			"drops the open of an agent that $expiry when it $outcome",
			async ({ expire, outcome }) => {
				const { tracker, opened } = await setup();
				const pending = Promise.withResolvers<MockMetadataStream>();
				opened.mockReturnValueOnce(pending.promise);
				const stale = tracker.watch(["agent-1"]);
				await expire(tracker);

				const old: MockMetadataStream = new MockEventStream();
				if (outcome === "resolves") pending.resolve(old);
				else pending.reject(new Error("stale error"));
				await stale;

				expect(old.close).toHaveBeenCalledTimes(outcome === "resolves" ? 1 : 0);
				expect(tracker.metadata).toEqual({});
			},
		);

		it("replays data received before the tracker subscribes", async () => {
			const { tracker, opened } = await setup();
			const socket: MockMetadataStream = new MockEventStream();
			const add = socket.addEventListener.bind(socket);
			vi.spyOn(socket, "addEventListener").mockImplementation(
				(event, listener) => {
					add(event, listener);
					if (event === "message")
						socket.pushMessage({ data: [agentMetadata()] });
				},
			);
			opened.mockResolvedValueOnce(socket);
			await tracker.watch(["agent-1"]);
			expect(tracker.metadata).toEqual({ "agent-1": REPORTED_METADATA });
		});
	});
});
