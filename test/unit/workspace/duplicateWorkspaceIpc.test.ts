import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DuplicateWorkspaceIpc } from "@/workspace/duplicateWorkspaceIpc";

import {
	InMemorySecretStorage,
	createMockLogger,
} from "../../mocks/testHelpers";

function makeIpcPair() {
	const secrets = new InMemorySecretStorage();
	return {
		secrets,
		sender: new DuplicateWorkspaceIpc(secrets, createMockLogger()),
		receiver: new DuplicateWorkspaceIpc(secrets, createMockLogger()),
	};
}

describe("DuplicateWorkspaceIpc", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("returns the PONG when another window responds to a PING", async () => {
		const { sender, receiver } = makeIpcPair();
		receiver.onRequest(async (msg) => {
			if (msg.type === "ping") {
				await receiver.sendPong(msg.id, "session-abc");
			}
		});

		const promise = sender.sendPing("ssh-remote+my-host", 2000);
		await vi.advanceTimersByTimeAsync(50);
		const pong = await promise;

		expect(pong).toMatchObject({
			type: "pong",
			sessionId: "session-abc",
		});
	});

	it("resolves to undefined when no window answers within the timeout", async () => {
		const { sender } = makeIpcPair();
		const promise = sender.sendPing("ssh-remote+my-host", 100);
		await vi.advanceTimersByTimeAsync(150);

		expect(await promise).toBeUndefined();
	});

	it("supports the full ping → pong → duplicate round trip", async () => {
		const { secrets, sender } = makeIpcPair();
		const duplicateReceived = vi.fn();

		const peer = new DuplicateWorkspaceIpc(secrets, createMockLogger());
		peer.onRequest(async (msg) => {
			if (msg.type === "ping" && msg.authority === "ssh-remote+host") {
				await peer.sendPong(msg.id, "win-a");
			} else if (msg.type === "duplicate" && msg.targetSessionId === "win-a") {
				duplicateReceived();
			}
		});

		const promise = sender.sendPing("ssh-remote+host", 2000);
		await vi.advanceTimersByTimeAsync(50);
		const pong = await promise;
		expect(pong).toMatchObject({ sessionId: "win-a" });

		await sender.sendDuplicate("win-a");
		await vi.advanceTimersByTimeAsync(10);
		expect(duplicateReceived).toHaveBeenCalledOnce();
	});
});
