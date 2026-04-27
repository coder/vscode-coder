import type { Disposable, SecretStorage } from "vscode";

import type { Logger } from "./logging/logger";

/**
 * Typed pub/sub over a single SecretStorage key.
 *
 * SecretStorage.onDidChange fires across all VS Code windows, so each
 * WindowBroadcast instance acts as a cross-window channel for messages
 * of type T.
 */
export class WindowBroadcast<T> {
	constructor(
		private readonly secrets: SecretStorage,
		private readonly key: string,
		private readonly validate: (value: unknown) => value is T,
		private readonly logger: Logger,
	) {}

	async send(msg: T): Promise<void> {
		await this.secrets.store(this.key, JSON.stringify(msg));
	}

	onReceive(handler: (msg: T) => void | Promise<void>): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== this.key) {
				return;
			}
			try {
				const raw = await this.secrets.get(this.key);
				if (!raw) {
					return;
				}
				const parsed: unknown = JSON.parse(raw);
				if (!this.validate(parsed)) {
					return;
				}
				await handler(parsed);
			} catch (err) {
				this.logger.error(`Error handling broadcast on ${this.key}`, err);
			}
		});
	}
}
