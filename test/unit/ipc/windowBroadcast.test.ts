import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import { WindowBroadcast } from "@/ipc/windowBroadcast";

import {
	InMemorySecretStorage,
	createMockLogger,
} from "../../mocks/testHelpers";

const TestMessageSchema = z.object({
	kind: z.string(),
	value: z.number(),
});
type TestMessage = z.infer<typeof TestMessageSchema>;

// SecretStorage.onDidChange fires synchronously after store(), but the
// listener body awaits a storage read before invoking the handler. Yield
// once to let those microtasks run.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

function makeBroadcast(key = "test.channel") {
	const secrets = new InMemorySecretStorage();
	const broadcast = new WindowBroadcast<TestMessage>(
		secrets,
		key,
		TestMessageSchema,
		createMockLogger(),
	);
	return { secrets, broadcast };
}

describe("WindowBroadcast", () => {
	it("delivers messages on its own key and ignores other keys", async () => {
		const { secrets, broadcast } = makeBroadcast("my.key");
		const other = new WindowBroadcast<TestMessage>(
			secrets,
			"other.key",
			TestMessageSchema,
			createMockLogger(),
		);

		const handler = vi.fn();
		broadcast.onReceive(handler);

		await other.send({ kind: "stranger", value: 1 });
		await flushAsync();
		expect(handler).not.toHaveBeenCalled();

		await broadcast.send({ kind: "self", value: 2 });
		await flushAsync();
		expect(handler).toHaveBeenCalledWith({ kind: "self", value: 2 });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("drops messages that fail schema validation", async () => {
		const { secrets, broadcast } = makeBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler);

		await secrets.store("test.channel", JSON.stringify({ kind: "x" }));
		await flushAsync();

		expect(handler).not.toHaveBeenCalled();
	});

	it("drops malformed JSON without crashing", async () => {
		const { secrets, broadcast } = makeBroadcast();
		const handler = vi.fn();
		broadcast.onReceive(handler);

		await secrets.store("test.channel", "{not json");
		await flushAsync();

		expect(handler).not.toHaveBeenCalled();
	});

	it("stops delivering after dispose", async () => {
		const { broadcast } = makeBroadcast();
		const handler = vi.fn();
		const subscription = broadcast.onReceive(handler);

		await broadcast.send({ kind: "before", value: 1 });
		await flushAsync();
		expect(handler).toHaveBeenCalledTimes(1);

		subscription.dispose();
		await broadcast.send({ kind: "after", value: 2 });
		await flushAsync();
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
