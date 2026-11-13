import { rawDataToString } from "@/websocket/oneWayWebSocket";

import { awaitOpen, connect } from "./server";

import type { ServerSentEvent } from "coder/site/src/api/typesGenerated";
import type WebSocket from "ws";

import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

import type { Deployment, Probe } from "./deployment";

type OpenStream = (
	deployment: Deployment,
) => Promise<UnidirectionalStream<unknown>>;

/** Passes once the server accepts the stream, for streams that authorize only the handshake. */
export function opens(open: OpenStream): Probe {
	return async (deployment) =>
		connect(deployment.scoped, await streamUrl(deployment, open));
}

/**
 * Passes on the first non-ping message. Fails on refusal, an error event, or
 * an early close, which means a per-message check failed.
 */
export function receives(open: OpenStream): Probe {
	return async (deployment) =>
		connect(deployment.scoped, await streamUrl(deployment, open), (socket) =>
			Promise.all([awaitOpen(socket), awaitEvent(socket)]),
		);
}

function awaitEvent(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.on("message", (message) => {
			const event = JSON.parse(rawDataToString(message)) as ServerSentEvent;
			if (event.type === "error") {
				reject(new Error(`Stream error: ${JSON.stringify(event.data)}`));
			} else if (event.type !== "ping") {
				resolve();
			}
		});
		socket.once("close", (code, reason) =>
			reject(new Error(`Closed with ${code} ${reason.toString()}`)),
		);
	});
}

/** Returns the URL the extension's client opens the stream at. */
async function streamUrl(
	deployment: Deployment,
	open: OpenStream,
): Promise<string> {
	const stream = await open(deployment);
	const { url } = stream;
	stream.close();
	return url;
}
