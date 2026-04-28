import crypto from "node:crypto";
import { z } from "zod";

import { WindowBroadcast } from "../ipc/windowBroadcast";

import type { Disposable, SecretStorage } from "vscode";

import type { Logger } from "../logging/logger";

const MESSAGE_MAX_AGE_MS = 5000;
const DEFAULT_PING_TIMEOUT_MS = 1000;

const REQUEST_KEY = "coder.ipc.req";
const RESPONSE_KEY = "coder.ipc.res";

const PingMessageSchema = z.object({
	type: z.literal("ping"),
	id: z.string(),
	authority: z.string(),
	ts: z.number(),
});

const PongMessageSchema = z.object({
	type: z.literal("pong"),
	id: z.string(),
	sessionId: z.string(),
	ts: z.number(),
});

const DuplicateMessageSchema = z.object({
	type: z.literal("duplicate"),
	id: z.string(),
	targetSessionId: z.string(),
	ts: z.number(),
});

const RequestMessageSchema = z.discriminatedUnion("type", [
	PingMessageSchema,
	DuplicateMessageSchema,
]);

export type PingMessage = z.infer<typeof PingMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type DuplicateMessage = z.infer<typeof DuplicateMessageSchema>;
export type RequestMessage = z.infer<typeof RequestMessageSchema>;

/**
 * Cross-window protocol for the open-workspace flow:
 *   PING      "anyone connected to this authority?"
 *   PONG      "yes, with this sessionId"
 *   DUPLICATE "sessionId, please duplicate yourself"
 *
 * The sender shows the prompt locally on first PONG. If the user picks
 * Duplicate, it sends DUPLICATE targeted at the responder's sessionId.
 */
export class DuplicateWorkspaceIpc {
	private readonly requests: WindowBroadcast<RequestMessage>;
	private readonly responses: WindowBroadcast<PongMessage>;

	constructor(
		secrets: SecretStorage,
		private readonly logger: Logger,
	) {
		this.requests = new WindowBroadcast(
			secrets,
			REQUEST_KEY,
			RequestMessageSchema,
			logger,
		);
		this.responses = new WindowBroadcast(
			secrets,
			RESPONSE_KEY,
			PongMessageSchema,
			logger,
		);
	}

	/** Send a PING and wait for a PONG within the timeout. */
	sendPing(
		authority: string,
		timeoutMs = DEFAULT_PING_TIMEOUT_MS,
	): Promise<PongMessage | undefined> {
		const id = crypto.randomUUID();

		return new Promise<PongMessage | undefined>((resolve) => {
			let settled = false;

			const settle = (result: PongMessage | undefined) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				listener.dispose();
				resolve(result);
			};

			const listener = this.responses.onReceive((msg) => {
				if (msg.id === id) {
					settle(msg);
				}
			});

			const timer = setTimeout(() => settle(undefined), timeoutMs);

			this.requests
				.send({ type: "ping", id, authority, ts: Date.now() })
				.then(undefined, (err: unknown) => {
					this.logger.error("Failed to send IPC ping", err);
					settle(undefined);
				});
		});
	}

	async sendPong(pingId: string, sessionId: string): Promise<void> {
		await this.responses.send({
			type: "pong",
			id: pingId,
			sessionId,
			ts: Date.now(),
		});
	}

	/** Ask the window with this sessionId to duplicate itself. */
	async sendDuplicate(targetSessionId: string): Promise<void> {
		await this.requests.send({
			type: "duplicate",
			id: crypto.randomUUID(),
			targetSessionId,
			ts: Date.now(),
		});
	}

	/** Listen for incoming requests. Stale messages are dropped. */
	onRequest(
		handler: (msg: RequestMessage) => void | Promise<void>,
	): Disposable {
		return this.requests.onReceive((msg) => {
			if (Date.now() - msg.ts > MESSAGE_MAX_AGE_MS) {
				return;
			}
			return handler(msg);
		});
	}
}
