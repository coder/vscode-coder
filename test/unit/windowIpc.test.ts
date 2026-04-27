import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WindowIpc } from "../../src/windowIpc";
import { InMemorySecretStorage, createMockLogger } from "../mocks/testHelpers";

function createIpcPair() {
	const secrets = new InMemorySecretStorage();
	const logger = createMockLogger();
	return {
		secrets,
		sender: new WindowIpc(secrets, logger),
		receiver: new WindowIpc(secrets, logger),
	};
}

describe("WindowIpc", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	describe("sendPing", () => {
		it("resolves with PONG when another window responds", async () => {
			const { sender, receiver } = createIpcPair();
			receiver.onRequest(async (msg) => {
				if (msg.type === "ping") {
					await receiver.sendPong(msg.id, "session-abc", "/home/coder/project");
				}
			});

			const promise = sender.sendPing("ssh-remote+my-host", 2000);
			await vi.advanceTimersByTimeAsync(50);

			expect(await promise).toMatchObject({
				sessionId: "session-abc",
				folder: "/home/coder/project",
			});
		});

		it("resolves undefined when no window responds", async () => {
			const { sender } = createIpcPair();
			const promise = sender.sendPing("ssh-remote+my-host", 100);
			await vi.advanceTimersByTimeAsync(150);

			expect(await promise).toBeUndefined();
		});
	});

	it("onRequest ignores stale messages", async () => {
		const { secrets, receiver } = createIpcPair();
		const handler = vi.fn();
		receiver.onRequest(handler);

		await secrets.store(
			"coder.ipc.req",
			JSON.stringify({
				type: "ping",
				id: "old",
				authority: "ssh-remote+host",
				ts: Date.now() - 10_000,
			}),
		);
		await vi.advanceTimersByTimeAsync(10);

		expect(handler).not.toHaveBeenCalled();
	});

	it("full ping → pong → duplicate round trip", async () => {
		const { secrets, sender } = createIpcPair();
		const duplicated = vi.fn();

		const windowA = new WindowIpc(secrets, createMockLogger());
		windowA.onRequest(async (msg) => {
			if (msg.type === "ping" && msg.authority === "ssh-remote+host") {
				await windowA.sendPong(msg.id, "win-a", "/home/coder/app");
			}
			if (msg.type === "duplicate" && msg.targetSessionId === "win-a") {
				duplicated();
			}
		});

		const promise = sender.sendPing("ssh-remote+host", 2000);
		await vi.advanceTimersByTimeAsync(50);
		const pong = await promise;

		expect(pong).toMatchObject({
			sessionId: "win-a",
			folder: "/home/coder/app",
		});

		await sender.sendDuplicate("win-a");
		await vi.advanceTimersByTimeAsync(10);

		expect(duplicated).toHaveBeenCalledOnce();
	});
});
