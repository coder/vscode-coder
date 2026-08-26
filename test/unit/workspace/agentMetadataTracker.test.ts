import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentMetadataTracker } from "@/workspace/agentMetadataTracker";

import { agentMetadata } from "@repo/mocks";

import { MockWorkspacesClient } from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

import type { AgentMetadataMap, AgentMetadataState } from "@repo/shared";

type MockAgentStream = NonNullable<
	ReturnType<ReturnType<typeof setup>["stream"]>
>;

const LINGER_MS = 1_000;
const PENDING = { metadata: [], error: null, loading: true };
const REPORTED = { metadata: [agentMetadata()], error: null, loading: false };

function setup() {
	const client = new MockWorkspacesClient();
	const tracker = new AgentMetadataTracker(client as unknown as CoderApi, {
		lingerMs: LINGER_MS,
	});
	const reports: AgentMetadataMap[] = [];
	tracker.onDidChange((metadata) => reports.push(metadata));
	return {
		client,
		tracker,
		reports,
		opened: vi.spyOn(client, "watchAgentMetadata"),
		stream: (agentId: string) => client.metadataStreams.get(agentId),
	};
}

describe("AgentMetadataTracker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports the agents it was given, with one socket each", async () => {
		const { opened, tracker, reports } = setup();

		await tracker.setWatched(["agent-1", "agent-2"]);
		await tracker.setWatched(["agent-2", "agent-3"]);

		expect(reports).toEqual([
			{ "agent-1": PENDING, "agent-2": PENDING },
			{ "agent-2": PENDING, "agent-3": PENDING },
		]);
		expect(tracker.metadata).toEqual(reports.at(-1));
		expect(opened.mock.calls.map(([agentId]) => agentId)).toEqual([
			"agent-1",
			"agent-2",
			"agent-3",
		]);
	});

	it("reports nothing when the watched set does not change", async () => {
		const { tracker, reports } = setup();

		await tracker.setWatched([]);

		expect(reports).toEqual([]);
	});

	it("opens a large fleet in parallel", async () => {
		const { client, tracker } = setup();

		await tracker.setWatched(
			Array.from({ length: 100 }, (_, i) => `agent-${i}`),
		);

		expect(client.metadataStreams.size).toBe(100);
		expect(Object.keys(tracker.metadata)).toHaveLength(100);
	});

	interface ReportCase {
		name: string;
		send: (stream: MockAgentStream) => void;
		reported: AgentMetadataState;
	}

	it.each<ReportCase>([
		{
			name: "metadata",
			send: (stream) => stream.pushMessage({ data: [agentMetadata()] }),
			reported: REPORTED,
		},
		{
			name: "a failure",
			send: (stream) => stream.pushError(new Error("boom")),
			reported: {
				metadata: [],
				error: "Failed to query metadata: boom",
				loading: false,
			},
		},
	])("reports $name an agent sends", async ({ send, reported }) => {
		const { tracker, stream } = setup();
		await tracker.setWatched(["agent-1"]);

		send(stream("agent-1")!);

		expect(tracker.metadata).toEqual({ "agent-1": reported });
	});

	describe("letting go", () => {
		it("keeps the socket for a while, in case the agent comes back", async () => {
			const { tracker, reports, stream } = setup();
			await tracker.setWatched(["agent-1"]);
			const socket = stream("agent-1");

			await tracker.setWatched([]);
			expect(tracker.metadata).toEqual({});
			expect(socket?.close).not.toHaveBeenCalled();

			// What it reports while lingering is recorded, but nobody is told.
			const reported = reports.length;
			socket?.pushMessage({ data: [agentMetadata()] });
			expect(reports).toHaveLength(reported);

			vi.advanceTimersByTime(LINGER_MS);

			expect(socket?.close).toHaveBeenCalled();
		});

		it("reuses a lingering socket, with what it already reported", async () => {
			const { opened, tracker, stream } = setup();
			await tracker.setWatched(["agent-1"]);
			stream("agent-1")?.pushMessage({ data: [agentMetadata()] });

			// Collapsing and expanding a row repeatedly must not reconnect.
			for (let i = 0; i < 5; i++) {
				await tracker.setWatched([]);
				vi.advanceTimersByTime(LINGER_MS / 2);
				await tracker.setWatched(["agent-1"]);
			}

			expect(opened).toHaveBeenCalledTimes(1);
			expect(tracker.metadata).toEqual({ "agent-1": REPORTED });
		});

		it("keeps the agents that never stopped being watched", async () => {
			const { tracker, reports } = setup();
			await tracker.setWatched(["agent-1", "agent-2"]);

			await tracker.setWatched(["agent-1"]);
			vi.advanceTimersByTime(LINGER_MS);

			expect(tracker.metadata).toEqual({ "agent-1": PENDING });
			expect(reports.at(-1)).toEqual({ "agent-1": PENDING });
		});
	});

	describe("recovering", () => {
		it("reports a socket that never opened, and retries it", async () => {
			const { client, tracker } = setup();
			vi.spyOn(client, "watchAgentMetadata").mockRejectedValueOnce(
				new Error("socket refused"),
			);

			await tracker.setWatched(["agent-1"]);
			expect(tracker.metadata).toEqual({
				"agent-1": {
					metadata: [],
					error: "Failed to query metadata: socket refused",
					loading: false,
				},
			});

			await tracker.setWatched(["agent-1"]);

			expect(client.metadataStreams.has("agent-1")).toBe(true);
		});

		it("reopens a socket that died on its own", async () => {
			const { opened, tracker, stream } = setup();
			await tracker.setWatched(["agent-1"]);
			stream("agent-1")?.emit("close", {
				code: 1006,
				reason: "gone",
				wasClean: false,
			});

			await tracker.setWatched(["agent-1"]);

			expect(opened).toHaveBeenCalledTimes(2);
		});
	});

	describe("shutting down", () => {
		it("closes everything and stops reporting once disposed", async () => {
			const { client, tracker, reports, stream } = setup();
			await tracker.setWatched(["agent-1", "agent-2"]);
			await tracker.setWatched(["agent-1"]);
			const dropped = stream("agent-1");
			const reported = reports.length;

			tracker.dispose();
			dropped?.pushMessage({ data: [agentMetadata()] });

			for (const socket of client.metadataStreams.values()) {
				expect(socket.close).toHaveBeenCalled();
			}
			expect(reports).toHaveLength(reported);
			expect(tracker.metadata).toEqual({});
		});

		it("drops a socket that opened after disposal", async () => {
			const { client, tracker } = setup();
			const opening = tracker.setWatched(["agent-1"]);

			tracker.dispose();
			await opening;

			expect(client.metadataStreams.get("agent-1")?.close).toHaveBeenCalled();
			expect(tracker.metadata).toEqual({});
		});
	});
});
