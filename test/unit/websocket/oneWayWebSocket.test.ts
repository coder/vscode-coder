import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { OneWayWebSocket } from "@/websocket/oneWayWebSocket";

describe("OneWayWebSocket", () => {
	let server: WebSocketServer;
	let host: string;

	beforeEach(async () => {
		server = new WebSocketServer({ port: 0 });
		await new Promise<void>((resolve) => server.once("listening", resolve));
		const { port } = server.address() as AddressInfo;
		host = `127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("delivers a DOM CloseEvent with code and reason to close listeners", async () => {
		server.on("connection", (socket) => {
			socket.close(1002, "protocol error");
		});

		const ws = new OneWayWebSocket({
			location: { protocol: "http:", host },
			apiRoute: "/api/v2/test",
		});

		const event = await new Promise<{ code: number; reason: string }>(
			(resolve) => {
				ws.addEventListener("close", (e) => {
					resolve({ code: e.code, reason: e.reason });
				});
			},
		);

		expect(event.code).toBe(1002);
		expect(event.reason).toBe("protocol error");
		ws.close();
	});
});
