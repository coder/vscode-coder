import type { SecretStorage } from "vscode";

export class SecretsManager {
	constructor(private readonly secrets: SecretStorage) {}

	/**
	 * Set or unset the last used token.
	 */
	public async setSessionToken(sessionToken?: string): Promise<void> {
		if (!sessionToken) {
			await this.secrets.delete("sessionToken");
		} else {
			await this.secrets.store("sessionToken", sessionToken);
		}
	}

	/**
	 * Get the last used token.
	 */
	public async getSessionToken(): Promise<string | undefined> {
		try {
			return await this.secrets.get("sessionToken");
		} catch {
			// The VS Code session store has become corrupt before, and
			// will fail to get the session token...
			return undefined;
		}
	}
}
