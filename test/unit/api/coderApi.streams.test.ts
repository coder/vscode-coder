import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import { CoderApi } from "@/api/coderApi";
import { getHeaders } from "@/headers";
import { ConnectionState } from "@/websocket/reconnectingWebSocket";

import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

// Env proxies would reroute loopback traffic.
vi.mock("@/api/httpAgent", () => ({
	createHttpAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/headers", () => ({ getHeaders: vi.fn() }));

describe("CoderApi streams", () => {
	let server: WebSocketServer;

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("delivers the message a server sends with the handshake, on every connect", async () => {
		server = new WebSocketServer({ port: 0 });
		await new Promise<void>((resolve) => server.once("listening", resolve));
		const { port } = server.address() as AddressInfo;
		let connections = 0;
		server.on("connection", (socket) => {
			connections++;
			socket.send(JSON.stringify({ connection: connections }));
			// Drop the first connection so the client reconnects.
			if (connections === 1) {
				setTimeout(() => socket.terminate(), 50);
			}
		});
		const _config = new MockConfigurationProvider();
		vi.mocked(getHeaders).mockResolvedValue({});
		const client = CoderApi.create(
			`http://127.0.0.1:${port}`,
			"token",
			createMockLogger(),
		);

		// Subscribe after the await, as every caller does.
		const socket = await client.watchAgentMetadata("agent-id");
		const received: unknown[] = [];
		socket.addEventListener("message", (event) => {
			received.push(event.parsedMessage);
		});

		await vi.waitFor(
			() => expect(received).toEqual([{ connection: 1 }, { connection: 2 }]),
			{ timeout: 3000 },
		);
		expect(socket.state).toBe(ConnectionState.CONNECTED);
		client.dispose();
	});
});
