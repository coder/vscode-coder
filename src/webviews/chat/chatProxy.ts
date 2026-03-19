import { randomBytes } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

import type * as net from "node:net";
import type * as vscode from "vscode";

import type { Logger } from "../../logging/logger";

/**
 * A local reverse proxy that injects the Coder session token into
 * all HTTP and WebSocket requests. The iframe loads from this proxy
 * instead of directly from the Coder server, so all requests are
 * transparently authenticated.
 *
 * A random secret path prefix prevents other local processes from
 * exploiting the proxy.
 */
export class ChatProxy implements vscode.Disposable {
	private readonly server: http.Server;
	private readonly secret: string;
	private readonly upstream: URL;
	private port = 0;

	constructor(
		private readonly coderUrl: string,
		private readonly sessionToken: string,
		private readonly logger: Logger,
	) {
		this.secret = randomBytes(16).toString("hex");
		this.upstream = new URL(coderUrl);

		this.server = http.createServer((req, res) => {
			this.handleRequest(req, res);
		});

		this.server.on("upgrade", (req, socket, head) => {
			this.handleUpgrade(req, socket as net.Socket, head);
		});
	}

	/**
	 * Start the proxy and return the local base URL including
	 * the secret prefix (e.g., http://127.0.0.1:PORT/SECRET).
	 */
	async listen(): Promise<string> {
		return new Promise((resolve, reject) => {
			this.server.listen(0, "127.0.0.1", () => {
				const addr = this.server.address();
				if (!addr || typeof addr === "string") {
					reject(new Error("Failed to get server address"));
					return;
				}
				this.port = addr.port;
				const baseUrl = `http://127.0.0.1:${this.port}/${this.secret}`;
				this.logger.info(`Chat proxy listening on port ${this.port}`);
				resolve(baseUrl);
			});
			this.server.on("error", reject);
		});
	}

	dispose(): void {
		this.server.close();
	}

	/**
	 * Validate the request path starts with the secret prefix.
	 * Returns the stripped path or undefined if invalid.
	 */
	private validateAndStripSecret(
		reqUrl: string | undefined,
	): string | undefined {
		if (!reqUrl) return undefined;
		const prefix = `/${this.secret}`;
		if (!reqUrl.startsWith(prefix)) return undefined;
		// Return the path after the secret, or "/" if nothing follows.
		return reqUrl.slice(prefix.length) || "/";
	}

	private handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		const strippedPath = this.validateAndStripSecret(req.url);
		if (!strippedPath) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}

		const upstreamUrl = new URL(strippedPath, this.coderUrl);

		const options: https.RequestOptions = {
			hostname: this.upstream.hostname,
			port:
				this.upstream.port || (this.upstream.protocol === "https:" ? 443 : 80),
			path: upstreamUrl.pathname + upstreamUrl.search,
			method: req.method,
			headers: {
				...req.headers,
				host: this.upstream.host,
				"Coder-Session-Token": this.sessionToken,
			},
		};

		// Remove headers that don't make sense for upstream.
		const headers = options.headers as Record<
			string,
			string | string[] | undefined
		>;
		delete headers["origin"];
		delete headers["referer"];

		const transport = this.upstream.protocol === "https:" ? https : http;
		const proxyReq = transport.request(options, (proxyRes) => {
			res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
			proxyRes.pipe(res, { end: true });
		});

		proxyReq.on("error", (err) => {
			this.logger.warn("Chat proxy request error", err);
			if (!res.headersSent) {
				res.writeHead(502);
			}
			res.end("Bad Gateway");
		});

		req.pipe(proxyReq, { end: true });
	}

	private handleUpgrade(
		req: http.IncomingMessage,
		socket: net.Socket,
		head: Buffer,
	): void {
		const strippedPath = this.validateAndStripSecret(req.url);
		if (!strippedPath) {
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}

		const upstreamUrl = new URL(strippedPath, this.coderUrl);
		const targetPort =
			this.upstream.port || (this.upstream.protocol === "https:" ? 443 : 80);

		const headers: Record<string, string> = {};
		// Forward relevant headers from the original request.
		for (const [key, value] of Object.entries(req.headers)) {
			if (value && key !== "host" && key !== "origin" && key !== "referer") {
				headers[key] = Array.isArray(value) ? value.join(", ") : value;
			}
		}
		headers["host"] = this.upstream.host;
		headers["Coder-Session-Token"] = this.sessionToken;

		const connectOptions: https.RequestOptions = {
			hostname: this.upstream.hostname,
			port: targetPort,
			path: upstreamUrl.pathname + upstreamUrl.search,
			method: "GET",
			headers,
		};

		const transport = this.upstream.protocol === "https:" ? https : http;
		const proxyReq = transport.request(connectOptions);

		proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
			// Build the raw HTTP 101 response to send back to the client.
			let responseHead = `HTTP/1.1 101 Switching Protocols\r\n`;
			for (const [key, value] of Object.entries(proxyRes.headers)) {
				if (value) {
					const vals = Array.isArray(value) ? value : [value];
					for (const v of vals) {
						responseHead += `${key}: ${v}\r\n`;
					}
				}
			}
			responseHead += "\r\n";

			socket.write(responseHead);
			if (proxyHead.length > 0) {
				socket.write(proxyHead);
			}
			if (head.length > 0) {
				proxySocket.write(head);
			}

			// Bidirectional pipe.
			proxySocket.pipe(socket);
			socket.pipe(proxySocket);

			proxySocket.on("error", () => socket.destroy());
			socket.on("error", () => proxySocket.destroy());
			proxySocket.on("close", () => socket.destroy());
			socket.on("close", () => proxySocket.destroy());
		});

		proxyReq.on("error", (err) => {
			this.logger.warn("Chat proxy WebSocket upgrade error", err);
			socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
			socket.destroy();
		});

		// If the upstream rejects the upgrade with a non-101 response,
		// forward the status back and close.
		proxyReq.on("response", (proxyRes) => {
			socket.write(
				`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`,
			);
			for (const [key, value] of Object.entries(proxyRes.headers)) {
				if (value) {
					const vals = Array.isArray(value) ? value : [value];
					for (const v of vals) {
						socket.write(`${key}: ${v}\r\n`);
					}
				}
			}
			socket.write("\r\n");
			proxyRes.pipe(socket);
		});

		proxyReq.end();
	}
}
