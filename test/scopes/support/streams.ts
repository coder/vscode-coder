import { CoderApi } from "@/api/coderApi";
import { rawDataToString } from "@/websocket/oneWayWebSocket";

import { LogCollector } from "../../mocks/testHelpers";

import { awaitOpen, openSocket } from "./server";

import type { ServerSentEvent } from "coder/site/src/api/typesGenerated";

import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

import type { Deployment, Probe } from "./deployment";

/** Opens a stream with the extension's client. */
type OpenStream = (
	api: CoderApi,
	deployment: Deployment,
) => Promise<UnidirectionalStream<unknown>>;

/** Passes once the stream opens, for streams that authorize only the handshake. */
export function opens(open: OpenStream): Probe {
	return (deployment) => streamUrl(deployment, open);
}

/**
 * Passes on the first non-ping message. Fails on refusal, an error event, or
 * an early close (a failed per-message check).
 */
export function receives(open: OpenStream): Probe {
	return async (deployment) => {
		// A plain socket listens before it connects, so unlike the extension's
		// client (#1141) it cannot miss a message sent right after the handshake.
		const socket = openSocket(
			deployment.scoped,
			await streamUrl(deployment, open),
		);
		const received = new Promise<void>((resolve, reject) => {
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
		try {
			await Promise.all([awaitOpen(socket), received]);
		} finally {
			socket.terminate();
		}
	};
}

/**
 * Opens and closes the stream with the extension's client and returns its URL.
 * Throws with the client's log if it does not open.
 */
async function streamUrl(
	deployment: Deployment,
	open: OpenStream,
): Promise<string> {
	const logger = new LogCollector();
	const api = CoderApi.create(deployment.url, deployment.token, logger);
	try {
		const stream = await open(api, deployment);
		const { url } = stream;
		stream.close();
		if (!url) {
			throw new Error(`Stream did not open. Client log:\n${logger.text}`);
		}
		return url;
	} finally {
		api.dispose();
	}
}
