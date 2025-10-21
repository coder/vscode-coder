import { type ClientRegistrationResponse } from "../oauth/types";

import type { SecretStorage, Disposable } from "vscode";

const SESSION_TOKEN_KEY = "sessionToken";

const LOGIN_STATE_KEY = "loginState";

const OAUTH_CLIENT_REGISTRATION_KEY = "oauthClientRegistration";

export enum AuthAction {
	LOGIN,
	LOGOUT,
	INVALID,
}

export class SecretsManager {
	constructor(private readonly secrets: SecretStorage) {}

	/**
	 * Set or unset the last used token.
	 */
	public async setSessionToken(sessionToken?: string): Promise<void> {
		if (sessionToken) {
			await this.secrets.store(SESSION_TOKEN_KEY, sessionToken);
		} else {
			await this.secrets.delete(SESSION_TOKEN_KEY);
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
	 * Triggers a login/logout event that propagates across all VS Code windows.
	 * Uses the secrets storage onDidChange event as a cross-window communication mechanism.
	 * Appends a timestamp to ensure the value always changes, guaranteeing the event fires.
	 */
	public async triggerLoginStateChange(
		action: "login" | "logout",
	): Promise<void> {
		const date = new Date().toISOString();
		await this.secrets.store(LOGIN_STATE_KEY, `${action}-${date}`);
	}

	/**
	 * Listens for login/logout events from any VS Code window.
	 * The secrets storage onDidChange event fires across all windows, enabling cross-window sync.
	 */
	public onDidChangeLoginState(
		listener: (state: AuthAction) => Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key === LOGIN_STATE_KEY) {
				const state = await this.secrets.get(LOGIN_STATE_KEY);
				if (state?.startsWith("login")) {
					listener(AuthAction.LOGIN);
				} else if (state?.startsWith("logout")) {
					listener(AuthAction.LOGOUT);
				} else {
					// Secret was deleted or is invalid
					listener(AuthAction.INVALID);
				}
			}
		});
	}

	/**
	 * Store OAuth client registration data.
	 */
	public async setOAuthClientRegistration(
		registration: ClientRegistrationResponse | undefined,
	): Promise<void> {
		if (registration) {
			await this.secrets.store(
				OAUTH_CLIENT_REGISTRATION_KEY,
				JSON.stringify(registration),
			);
		} else {
			await this.secrets.delete(OAUTH_CLIENT_REGISTRATION_KEY);
		}
	}

	/**
	 * Get OAuth client registration data.
	 */
	public async getOAuthClientRegistration(): Promise<
		ClientRegistrationResponse | undefined
	> {
		try {
			const stringifiedResponse = await this.secrets.get(
				OAUTH_CLIENT_REGISTRATION_KEY,
			);
			if (stringifiedResponse) {
				return JSON.parse(stringifiedResponse) as ClientRegistrationResponse;
			}
		} catch {
			// Do nothing
		}
		return undefined;
	}
}
