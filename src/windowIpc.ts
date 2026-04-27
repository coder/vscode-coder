import crypto from "node:crypto";

import { WindowBroadcast } from "./windowBroadcast";

import type { Disposable, SecretStorage } from "vscode";

import type { Logger } from "./logging/logger";

const MESSAGE_MAX_AGE_MS = 5000;
const DEFAULT_PING_TIMEOUT_MS = 1000;

export interface PingMessage {
	type: "ping";
	id: string;
	authority: string;
	ts: number;
}

export interface PongMessage {
	type: "pong";
	id: string;
	sessionId: string;
	folder: string;
	ts: number;
}

export interface DuplicateMessage {
	type: "duplicate";
	id: string;
	targetSessionId: string;
	ts: number;
}

type RequestMessage = PingMessage | DuplicateMessage;

function isRequestMessage(msg: unknown): msg is RequestMessage {
	if (typeof msg !== "object" || msg === null) {
		return false;
	}
	const obj = msg as Record<string, unknown>;
	if (typeof obj.id !== "string" || typeof obj.ts !== "number") {
		return false;
	}
	if (obj.type === "ping") {
		return typeof obj.authority === "string";
	}
	if (obj.type === "duplicate") {
		return typeof obj.targetSessionId === "string";
	}
	return false;
}

function isPongMessage(msg: unknown): msg is PongMessage {
	if (typeof msg !== "object" || msg === null) {
		return false;
	}
	const obj = msg as Record<string, unknown>;
	return (
		obj.type === "pong" &&
		typeof obj.id === "string" &&
		typeof obj.sessionId === "string" &&
		typeof obj.folder === "string" &&
		typeof obj.ts === "number"
	);
}

/** Cross-window IPC built on WindowBroadcast channels. */
export class WindowIpc {
	private readonly requests: WindowBroadcast<RequestMessage>;
	private readonly responses: WindowBroadcast<PongMessage>;

	constructor(
		secrets: SecretStorage,
		private readonly logger: Logger,
	) {
		this.requests = new WindowBroadcast(
			secrets,
			"coder.ipc.req",
			isRequestMessage,
			logger,
		);
		this.responses = new WindowBroadcast(
			secrets,
			"coder.ipc.res",
			isPongMessage,
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

	async sendPong(
		pingId: string,
		sessionId: string,
		folder: string,
	): Promise<void> {
		await this.responses.send({
			type: "pong",
			id: pingId,
			sessionId,
			folder,
			ts: Date.now(),
		});
	}

	async sendDuplicate(targetSessionId: string): Promise<void> {
		await this.requests.send({
			type: "duplicate",
			id: crypto.randomUUID(),
			targetSessionId,
			ts: Date.now(),
		});
	}

	/** Listen for incoming requests. Stale messages are ignored. */
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
