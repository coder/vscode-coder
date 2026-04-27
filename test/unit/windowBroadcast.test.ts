import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WindowBroadcast } from "../../src/windowBroadcast";
import { InMemorySecretStorage, createMockLogger } from "../mocks/testHelpers";

interface TestMessage {
	kind: string;
	value: number;
}

function isTestMessage(v: unknown): v is TestMessage {
	if (typeof v !== "object" || v === null) {
		return false;
	}
	const obj = v as Record<string, unknown>;
	return typeof obj.kind === "string" && typeof obj.value === "number";
}

function createBroadcast(key = "test.channel") {
	const secrets = new InMemorySecretStorage();
	const logger = createMockLogger();
	const broadcast = new WindowBroadcast(secrets, key, isTestMessage, logger);
	return { secrets, logger, broadcast };
}

describe("WindowBroadcast", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("delivers sent messages to receivers", async () => {
		const { broadcast } = createBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler);

		await broadcast.send({ kind: "greeting", value: 42 });
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).toHaveBeenCalledWith({ kind: "greeting", value: 42 });
	});

	it("ignores messages on other keys", async () => {
		const { secrets } = createBroadcast("my.key");
		const other = new WindowBroadcast(
			secrets,
			"other.key",
			isTestMessage,
			createMockLogger(),
		);

		const handler = vi.fn();
		other.onReceive(handler);

		await secrets.store("my.key", JSON.stringify({ kind: "x", value: 1 }));
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores messages that fail validation", async () => {
		const { secrets, broadcast } = createBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler);

		await secrets.store("test.channel", JSON.stringify({ bad: "shape" }));
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores malformed JSON without crashing", async () => {
		const { secrets, broadcast } = createBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler);

		await secrets.store("test.channel", "{not json");
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).not.toHaveBeenCalled();
	});

	it("stops delivering after dispose", async () => {
		const { broadcast } = createBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler).dispose();

		await broadcast.send({ kind: "late", value: 0 });
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).not.toHaveBeenCalled();
	});
});
