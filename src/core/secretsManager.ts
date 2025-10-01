import type { SecretStorage, Disposable } from "vscode";

const SESSION_TOKEN_KEY = "sessionToken";

const LOGIN_STATE_KEY = "loginState";

type AuthAction = "login" | "logout";
export class SecretsManager {
	constructor(private readonly secrets: SecretStorage) {
		void this.secrets.delete(LOGIN_STATE_KEY);
	}

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

	public triggerLoginStateChange(action: AuthAction): void {
		this.secrets.store(LOGIN_STATE_KEY, action);
	}

	public onDidChangeLoginState(
		listener: (state?: AuthAction) => Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key === LOGIN_STATE_KEY) {
				const state = await this.secrets.get(LOGIN_STATE_KEY);
				listener(state as AuthAction | undefined);
			}
		});
	}
}
