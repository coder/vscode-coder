import { z } from "zod";

import { WindowBroadcast } from "../ipc/windowBroadcast";

import type { Disposable, SecretStorage } from "vscode";

import type { Logger } from "../logging/logger";

const OAUTH_CALLBACK_KEY = "coder.oauthCallback";

const OAuthCallbackDataSchema = z.object({
	state: z.string(),
	code: z.string().nullable(),
	error: z.string().nullable(),
});

export type OAuthCallbackData = z.infer<typeof OAuthCallbackDataSchema>;

/**
 * Forwards OAuth redirect parameters from the URI handler back to the
 * window that initiated the login. Required because the redirect may
 * land in a different window than the one that started the flow.
 */
export class OAuthCallback {
	private readonly broadcast: WindowBroadcast<OAuthCallbackData>;

	constructor(secrets: SecretStorage, logger: Logger) {
		this.broadcast = new WindowBroadcast(
			secrets,
			OAUTH_CALLBACK_KEY,
			OAuthCallbackDataSchema,
			logger,
		);
	}

	send(data: OAuthCallbackData): Promise<void> {
		return this.broadcast.send(data);
	}

	onReceive(
		handler: (data: OAuthCallbackData) => void | Promise<void>,
	): Disposable {
		return this.broadcast.onReceive(handler);
	}
}
