import { type AddressInfo } from "node:net";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
} from "vitest";
import { WebSocketServer } from "ws";

import { CrossOriginRedirectError } from "@/error/crossOriginRedirectError";
import { toError } from "@/error/normalize";
import { WebSocketCloseCode } from "@/websocket/codes";
import { OneWayWebSocket } from "@/websocket/oneWayWebSocket";

import { startRecordingServer } from "../../mocks/recordingServer";

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
			socket.close(WebSocketCloseCode.PROTOCOL_ERROR, "protocol error");
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

		expect(event.code).toBe(WebSocketCloseCode.PROTOCOL_ERROR);
		expect(event.reason).toBe("protocol error");
		ws.close();
	});
});

function connect(host: string) {
	const socket = new OneWayWebSocket({
		location: { protocol: "http:", host },
		apiRoute: "/old",
		options: {
			followRedirects: true,
			headers: { "Coder-Session-Token": "session-token" },
		},
	});
	onTestFinished(() => socket.close());
	const opened = new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve());
		socket.addEventListener("error", (event) => reject(toError(event.error)));
	});
	return { socket, opened };
}

describe("OneWayWebSocket redirects", () => {
	it("follows same-origin redirects with caller headers", async () => {
		const deployment = await startRecordingServer((path) =>
			path === "/old" ? "/new" : undefined,
		);

		const { socket, opened } = connect(deployment.host);
		await opened;

		expect(socket.url).toBe(`ws://${deployment.host}/new`);
		expect(
			deployment.requests.map((headers) => headers["coder-session-token"]),
		).toEqual(["session-token", "session-token"]);
	});

	it.each([
		["another origin", (host: string, other: string) => `ws://${other}/api`],
		["added credentials", (host: string) => `ws://user:pass@${host}/api`],
	])("refuses a redirect to %s", async (_name, location) => {
		const other = await startRecordingServer();
		const deployment = await startRecordingServer(() =>
			location(deployment.host, other.host),
		);

		await expect(connect(deployment.host).opened).rejects.toThrow(
			CrossOriginRedirectError,
		);
		expect(deployment.requests).toHaveLength(1);
		expect(other.requests).toHaveLength(0);
	});
});
