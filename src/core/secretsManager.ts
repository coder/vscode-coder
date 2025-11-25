import {
	type TokenResponse,
	type ClientRegistrationResponse,
} from "../oauth/types";

import type { Memento, SecretStorage, Disposable } from "vscode";

const SESSION_KEY_PREFIX = "coder.session.";
const OAUTH_TOKENS_PREFIX = "coder.oauth.tokens.";
const OAUTH_CLIENT_PREFIX = "coder.oauth.client.";

const LOGIN_STATE_KEY = "coder.loginState";
const OAUTH_CALLBACK_KEY = "coder.oauthCallback";

const KNOWN_LABELS_KEY = "coder.knownLabels";

const LEGACY_SESSION_TOKEN_KEY = "sessionToken";

export type StoredOAuthTokens = Omit<TokenResponse, "expires_in"> & {
	expiry_timestamp: number;
	deployment_url: string;
};

export interface SessionAuth {
	url: string;
	token: string;
}

interface OAuthCallbackData {
	state: string;
	code: string | null;
	error: string | null;
}

export enum AuthAction {
	LOGIN,
	LOGOUT,
	INVALID,
}

export class SecretsManager {
	constructor(
		private readonly secrets: SecretStorage,
		private readonly memento: Memento,
	) {}

	/**
	 * Triggers a login/logout event that propagates across all VS Code windows.
	 */
	public async triggerLoginStateChange(
		label: string,
		action: "login" | "logout",
	): Promise<void> {
		const loginState = {
			action,
			label,
			timestamp: new Date().toISOString(),
		};
		await this.secrets.store(LOGIN_STATE_KEY, JSON.stringify(loginState));
	}

	/**
	 * Listens for login/logout events from any VS Code window.
	 */
	public onDidChangeLoginState(
		listener: (state: AuthAction, label: string) => Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== LOGIN_STATE_KEY) {
				return;
			}

			const stateStr = await this.secrets.get(LOGIN_STATE_KEY);
			if (!stateStr) {
				await listener(AuthAction.INVALID, "");
				return;
			}

			try {
				const parsed = JSON.parse(stateStr) as {
					action: string;
					label: string;
					timestamp: string;
				};

				if (parsed.action === "login") {
					await listener(AuthAction.LOGIN, parsed.label);
				} else if (parsed.action === "logout") {
					await listener(AuthAction.LOGOUT, parsed.label);
				} else {
					await listener(AuthAction.INVALID, parsed.label);
				}
			} catch {
				// Invalid JSON, treat as invalid state
				await listener(AuthAction.INVALID, "");
			}
		});
	}

	/**
	 * Write an OAuth callback result to secrets storage.
	 * Used for cross-window communication when OAuth callback arrives in a different window.
	 */
	public async setOAuthCallback(data: OAuthCallbackData): Promise<void> {
		await this.secrets.store(OAUTH_CALLBACK_KEY, JSON.stringify(data));
	}

	/**
	 * Listen for OAuth callback results from any VS Code window.
	 * The listener receives the state parameter, code (if success), and error (if failed).
	 */
	public onDidChangeOAuthCallback(
		listener: (data: OAuthCallbackData) => void,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== OAUTH_CALLBACK_KEY) {
				return;
			}

			try {
				const data = await this.secrets.get(OAUTH_CALLBACK_KEY);
				if (data) {
					const parsed = JSON.parse(data) as OAuthCallbackData;
					listener(parsed);
				}
			} catch {
				// Ignore parse errors
			}
		});
	}

	/**
	 * Listen for changes to a specific deployment's session auth.
	 */
	public onDidChangeDeploymentAuth(
		label: string,
		listener: (auth: SessionAuth | undefined) => void | Promise<void>,
	): Disposable {
		const key = `${SESSION_KEY_PREFIX}${label}`;
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== key) {
				return;
			}
			const auth = await this.getSessionAuth(label);
			await listener(auth);
		});
	}

	public async getSessionAuth(label: string): Promise<SessionAuth | undefined> {
		try {
			const data = await this.secrets.get(`${SESSION_KEY_PREFIX}${label}`);
			if (!data) {
				return undefined;
			}
			return JSON.parse(data) as SessionAuth;
		} catch {
			return undefined;
		}
	}

	public async getSessionToken(label: string): Promise<string | undefined> {
		const auth = await this.getSessionAuth(label);
		return auth?.token;
	}

	public async getUrl(label: string): Promise<string | undefined> {
		const auth = await this.getSessionAuth(label);
		return auth?.url;
	}

	public async setSessionAuth(label: string, auth: SessionAuth): Promise<void> {
		await this.secrets.store(
			`${SESSION_KEY_PREFIX}${label}`,
			JSON.stringify(auth),
		);
		await this.addKnownLabel(label);
	}

	public async clearSessionAuth(label: string): Promise<void> {
		await this.secrets.delete(`${SESSION_KEY_PREFIX}${label}`);
	}

	public async getOAuthTokens(
		label: string,
	): Promise<StoredOAuthTokens | undefined> {
		try {
			const data = await this.secrets.get(`${OAUTH_TOKENS_PREFIX}${label}`);
			if (!data) {
				return undefined;
			}
			return JSON.parse(data) as StoredOAuthTokens;
		} catch {
			return undefined;
		}
	}

	public async setOAuthTokens(
		label: string,
		tokens: StoredOAuthTokens,
	): Promise<void> {
		await this.secrets.store(
			`${OAUTH_TOKENS_PREFIX}${label}`,
			JSON.stringify(tokens),
		);
		await this.addKnownLabel(label);
	}

	public async clearOAuthTokens(label: string): Promise<void> {
		await this.secrets.delete(`${OAUTH_TOKENS_PREFIX}${label}`);
	}

	public async getOAuthClientRegistration(
		label: string,
	): Promise<ClientRegistrationResponse | undefined> {
		try {
			const data = await this.secrets.get(`${OAUTH_CLIENT_PREFIX}${label}`);
			if (!data) {
				return undefined;
			}
			return JSON.parse(data) as ClientRegistrationResponse;
		} catch {
			return undefined;
		}
	}

	public async setOAuthClientRegistration(
		label: string,
		registration: ClientRegistrationResponse,
	): Promise<void> {
		await this.secrets.store(
			`${OAUTH_CLIENT_PREFIX}${label}`,
			JSON.stringify(registration),
		);
		await this.addKnownLabel(label);
	}

	public async clearOAuthClientRegistration(label: string): Promise<void> {
		await this.secrets.delete(`${OAUTH_CLIENT_PREFIX}${label}`);
	}

	public async clearOAuthData(label: string): Promise<void> {
		await Promise.all([
			this.clearOAuthTokens(label),
			this.clearOAuthClientRegistration(label),
		]);
	}

	/**
	 * TODO currently it might be used wrong because we can be connected to a remote deployment
	 * and we log out from the sidebar causing the session to be removed and the auto-refresh disabled.
	 *
	 * Potential solutions:
	 * 1. Keep the last 10 auths and possibly remove entries not used in a while instead.
	 * 	  We do not remove entries on logout!
	 * 2. Show the user a warning that their remote deployment might be disconnected.
	 *
	 * Update all usages of this after arriving at a decision!
	 */
	public async clearAllAuthData(label: string): Promise<void> {
		await Promise.all([
			this.clearSessionAuth(label),
			this.clearOAuthData(label),
		]);
		await this.removeKnownLabel(label);
	}

	public getKnownLabels(): string[] {
		return this.memento.get<string[]>(KNOWN_LABELS_KEY) ?? [];
	}

	private async addKnownLabel(label: string): Promise<void> {
		const labels = new Set(this.getKnownLabels());
		if (!labels.has(label)) {
			labels.add(label);
			await this.memento.update(KNOWN_LABELS_KEY, Array.from(labels));
		}
	}

	private async removeKnownLabel(label: string): Promise<void> {
		const labels = new Set(this.getKnownLabels());
		if (labels.has(label)) {
			labels.delete(label);
			await this.memento.update(KNOWN_LABELS_KEY, Array.from(labels));
		}
	}

	/**
	 * Migrate from legacy flat sessionToken storage to new format.
	 */
	public async migrateFromLegacyStorage(
		url: string,
		label: string,
	): Promise<boolean> {
		const existing = await this.getSessionAuth(label);
		if (existing) {
			return false;
		}

		const oldToken = await this.secrets.get(LEGACY_SESSION_TOKEN_KEY);
		if (!oldToken) {
			return false;
		}

		await this.setSessionAuth(label, { url, token: oldToken });
		await this.secrets.delete(LEGACY_SESSION_TOKEN_KEY);

		return true;
	}
}
