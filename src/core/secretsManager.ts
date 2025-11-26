import { toSafeHost } from "../util";

import type { Memento, SecretStorage, Disposable } from "vscode";

import type { TokenResponse, ClientRegistrationResponse } from "../oauth/types";

import type { Deployment } from "./deployment";

const SESSION_KEY_PREFIX = "coder.session.";
const OAUTH_TOKENS_PREFIX = "coder.oauth.tokens.";
const OAUTH_CLIENT_PREFIX = "coder.oauth.client.";

const CURRENT_DEPLOYMENT_KEY = "coder.currentDeployment";
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

export interface CurrentDeploymentState {
	deployment: Deployment | null;
}

export class SecretsManager {
	constructor(
		private readonly secrets: SecretStorage,
		private readonly memento: Memento,
	) {}

	/**
	 * Sets the current deployment and triggers a cross-window sync event.
	 * This is the single source of truth for which deployment is currently active.
	 */
	public async setCurrentDeployment(
		deployment: Deployment | undefined,
	): Promise<void> {
		const state = {
			deployment: deployment ?? null,
			timestamp: new Date().toISOString(),
		};
		await this.secrets.store(CURRENT_DEPLOYMENT_KEY, JSON.stringify(state));
	}

	/**
	 * Gets the current deployment from storage.
	 */
	public async getCurrentDeployment(): Promise<Deployment | undefined> {
		try {
			const data = await this.secrets.get(CURRENT_DEPLOYMENT_KEY);
			if (!data) {
				return undefined;
			}
			const parsed = JSON.parse(data) as { deployment: Deployment | null };
			return parsed.deployment ?? undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Listens for deployment changes from any VS Code window.
	 * Fires when login, logout, or deployment switch occurs.
	 */
	public onDidChangeCurrentDeployment(
		listener: (state: CurrentDeploymentState) => void | Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== CURRENT_DEPLOYMENT_KEY) {
				return;
			}

			try {
				const data = await this.secrets.get(CURRENT_DEPLOYMENT_KEY);
				if (data) {
					const parsed = JSON.parse(data) as {
						deployment: Deployment | null;
					};
					await listener({ deployment: parsed.deployment });
				}
			} catch {
				// Ignore parse errors
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
	public onDidChangeSessionAuth(
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
		if (!label) {
			return undefined;
		}

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
	 * Also sets the current deployment if none exists.
	 */
	public async migrateFromLegacyStorage(): Promise<string | undefined> {
		const legacyUrl = this.memento.get<string>("url");
		if (!legacyUrl) {
			return undefined;
		}

		const label = toSafeHost(legacyUrl);

		const existing = await this.getSessionAuth(label);
		if (existing) {
			return undefined;
		}

		const oldToken = await this.secrets.get(LEGACY_SESSION_TOKEN_KEY);
		if (!oldToken) {
			return undefined;
		}

		await this.setSessionAuth(label, { url: legacyUrl, token: oldToken });
		await this.secrets.delete(LEGACY_SESSION_TOKEN_KEY);

		// Also set as current deployment if none exists
		const currentDeployment = await this.getCurrentDeployment();
		if (!currentDeployment) {
			await this.setCurrentDeployment({ url: legacyUrl, label });
		}

		return label;
	}
}
