import type { SecretStorage, Disposable } from "vscode";

const SESSION_TOKEN_KEY = "sessionToken";

export class SecretsManager {
	constructor(private readonly secrets: SecretStorage) {}

	/**
	 * Set or unset the last used token.
	 */
	public async setSessionToken(sessionToken?: string): Promise<void> {
		if (!sessionToken) {
			await this.secrets.delete(SESSION_TOKEN_KEY);
		} else {
			await this.secrets.store(SESSION_TOKEN_KEY, sessionToken);
		}
	}

	/**
	 * Get the last used token.
	 */
	public async getSessionToken(): Promise<string | undefined> {
		try {
			return await this.secrets.get(SESSION_TOKEN_KEY);
		} catch {
			// The VS Code session store has become corrupt before, and
			// will fail to get the session token...
			return undefined;
		}
	}

	/**
	 * Subscribe to changes to the session token which can be used to indicate user login status.
	 */
	public onDidChangeSessionToken(listener: () => Promise<void>): Disposable {
		return this.secrets.onDidChange((e) => {
			if (e.key === SESSION_TOKEN_KEY) {
				listener();
			}
		});
	}
}
