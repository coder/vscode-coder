import { EventSource } from "eventsource";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { handshakeStatus } from "@/websocket/utils";

// `handshakeStatus` parses two libraries' internal error text, and neither is a
// contract. Drive real clients against a rejecting server so a library reword
// fails here instead of silently turning every unrecoverable status into a
// retry-forever connection_error.
describe("handshakeStatus", () => {
	let server: http.Server;

	const listen = (statusCode: number): Promise<string> => {
		server = http.createServer((_req, res) => {
			res.statusCode = statusCode;
			res.end();
		});
		return new Promise<string>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } = server.address() as AddressInfo;
				resolve(`127.0.0.1:${port}`);
			});
		});
	};

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("parses the status from a ws upgrade rejection", async () => {
		const host = await listen(404);
		const ws = new WebSocket(`ws://${host}`);

		const error = await new Promise<Error>((resolve) => {
			ws.on("error", resolve);
		});

		expect(handshakeStatus(error)).toBe(404);
	});

	it("parses the status from an EventSource handshake rejection", async () => {
		const host = await listen(403);
		const source = new EventSource(`http://${host}`);

		const error = await new Promise<unknown>((resolve) => {
			source.onerror = (event) => resolve(event);
		});
		source.close();

		expect(handshakeStatus(error)).toBe(403);
	});
});
