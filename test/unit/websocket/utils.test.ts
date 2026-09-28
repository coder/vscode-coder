import axios from "axios";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ErrorEvent } from "@/websocket/eventStreamConnection";
import { OneWayWebSocket } from "@/websocket/oneWayWebSocket";
import { SseConnection } from "@/websocket/sseConnection";
import { HandshakeError, handshakeStatus } from "@/websocket/utils";

import { createMockLogger } from "../../mocks/testHelpers";

describe("handshakeStatus", () => {
	it("reads status independently of the message", () => {
		expect(handshakeStatus(new HandshakeError(403, "Unavailable"))).toBe(403);
	});

	it.each([
		undefined,
		null,
		404,
		{ statusCode: 404 },
		"Unexpected server response: 404",
		new Error("Unexpected server response: 404"),
		new Error("Non-200 status code (403)"),
		new Error("connect ECONNREFUSED 127.0.0.1:4040"),
	])("ignores untyped errors: %s", (error) => {
		expect(handshakeStatus(error)).toBeUndefined();
	});
});

describe("handshake errors from real transports", () => {
	let server: http.Server;

	const listen = (statusCode: number, unfinished = false): Promise<string> => {
		server = http.createServer((_req, res) => {
			res.writeHead(statusCode);
			if (unfinished) {
				res.flushHeaders();
			} else {
				res.end();
			}
		});
		return new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } = server.address() as AddressInfo;
				resolve(`127.0.0.1:${port}`);
			});
		});
	};

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it.each([false, true])(
		"reports and closes a rejected WebSocket handshake (unfinished response: %s)",
		async (unfinished) => {
			const host = await listen(404, unfinished);
			const disconnected = new Promise<void>((resolve) => {
				server.on("connection", (socket) => socket.once("close", resolve));
			});
			const ws = new OneWayWebSocket({
				location: { protocol: "http:", host },
				apiRoute: "/",
			});
			const events: string[] = [];
			const onError = vi.fn((event: ErrorEvent) => {
				events.push("error");
				expect(handshakeStatus(event.error)).toBe(404);
				expect(event.error).toMatchObject({ cause: expect.any(Error) });
				ws.close();
			});
			const removed = vi.fn();
			ws.addEventListener("error", removed);
			ws.removeEventListener("error", removed);
			ws.addEventListener("error", onError);
			ws.addEventListener("error", onError);

			await new Promise<void>((resolve) => {
				ws.addEventListener("close", () => {
					events.push("close");
					resolve();
				});
			});
			await disconnected;

			expect(events).toEqual(["error", "close"]);
			expect(onError).toHaveBeenCalledOnce();
			expect(removed).not.toHaveBeenCalled();
		},
	);

	it("reports the status from an SSE handshake rejection", async () => {
		const host = await listen(403);
		const source = new SseConnection({
			location: { protocol: "http:", host },
			apiRoute: "/",
			axiosInstance: axios.create({ proxy: false }),
			logger: createMockLogger(),
		});
		try {
			const event = await new Promise<ErrorEvent>((resolve) => {
				source.addEventListener("error", resolve);
			});
			expect(handshakeStatus(event.error)).toBe(403);
		} finally {
			source.close();
		}
	});
});
