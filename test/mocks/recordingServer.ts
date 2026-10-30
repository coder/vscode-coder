import http from "node:http";
import { onTestFinished } from "vitest";
import { WebSocketServer } from "ws";

import type { AddressInfo } from "node:net";

export interface RecordingServer {
	/** Headers of every request, WebSocket upgrades included. */
	readonly requests: http.IncomingHttpHeaders[];
	readonly host: string;
	readonly origin: string;
}

/**
 * A loopback server that records request headers and closes when the test
 * finishes. `redirect` maps a path to a 302 location, or undefined to serve it.
 */
export async function startRecordingServer(
	redirect: (path: string) => string | undefined = () => undefined,
): Promise<RecordingServer> {
	const requests: http.IncomingHttpHeaders[] = [];
	const handle = (req: http.IncomingMessage) => {
		requests.push(req.headers);
		return redirect(req.url ?? "");
	};

	const server = http.createServer((req, res) => {
		const location = handle(req);
		res.writeHead(location ? 302 : 200, location ? { location } : {}).end();
	});
	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req, socket, head) => {
		const location = handle(req);
		if (location) {
			socket.end(`HTTP/1.1 302 Found\r\nLocation: ${location}\r\n\r\n`);
		} else {
			wss.handleUpgrade(req, socket, head, (client) => client.close());
		}
	});

	onTestFinished(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { requests, host, origin: `http://${host}` };
}
