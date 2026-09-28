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
		new Error("Unexpected server response: 404"),
		new Error("Non-200 status code (403)"),
	])("ignores untyped errors: %s", (error) => {
		expect(handshakeStatus(error)).toBeUndefined();
	});
});

describe("handshake errors from real transports", () => {
	let server: http.Server;

	const listen = (statusCode: number): Promise<string> => {
		server = http.createServer((_req, res) => {
			res.writeHead(statusCode);
			res.flushHeaders();
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

	it("reports the status before closing an unfinished WebSocket handshake", async () => {
		const host = await listen(404);
		const disconnected = new Promise<void>((resolve) => {
			server.on("connection", (socket) => socket.once("close", resolve));
		});
		const ws = new OneWayWebSocket({
			location: { protocol: "http:", host },
			apiRoute: "/",
		});
		const events: Array<number | undefined> = [];
		const onError = (event: ErrorEvent) => {
			events.push(handshakeStatus(event.error));
			ws.removeEventListener("error", onError);
			ws.close();
		};
		const removed = vi.fn();
		ws.addEventListener("error", removed);
		ws.removeEventListener("error", removed);
		ws.addEventListener("error", onError);
		ws.addEventListener("error", onError);

		await new Promise<void>((resolve) => {
			ws.addEventListener("close", (event) => {
				events.push(event.code);
				resolve();
			});
		});
		await disconnected;

		expect(events).toEqual([404, 1006]);
		expect(removed).not.toHaveBeenCalled();
	});

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
