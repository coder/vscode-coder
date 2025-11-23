import {
	type TokenResponse,
	type ClientRegistrationResponse,
} from "../oauth/types";
import { toSafeHost } from "../util";

import type { SecretStorage, Disposable } from "vscode";

const SESSION_TOKEN_KEY = "sessionToken";

const LOGIN_STATE_KEY = "loginState";

const OAUTH_CALLBACK_KEY = "coder.oauthCallback";

const SESSION_AUTH_MAP_KEY = "coder.sessionAuthMap";
const OAUTH_DATA_MAP_KEY = "coder.oauthDataMap";

export type StoredOAuthTokens = Omit<TokenResponse, "expires_in"> & {
	expiry_timestamp: number;
	deployment_url: string;
};

export interface SessionAuth {
	url: string;
	sessionToken: string;
}

export interface OAuthData {
	oauthClientRegistration?: ClientRegistrationResponse;
	oauthTokens?: StoredOAuthTokens;
}

export type SessionAuthMap = Record<string, SessionAuth>;
export type OAuthDataMap = Record<string, OAuthData>;

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
	/**
	 * Track previous session tokens to detect actual changes.
	 * Maps label -> previous sessionToken value.
	 */
	private readonly previousSessionTokens = new Map<
		string,
		string | undefined
	>();

	constructor(private readonly secrets: SecretStorage) {
		// Initialize previous session tokens
		this.getSessionAuthMap().then((map) => {
			for (const [label, auth] of Object.entries(map)) {
				this.previousSessionTokens.set(label, auth.sessionToken);
			}
		});
	}

	/**
	 * Triggers a login/logout event that propagates across all VS Code windows.
	 * Uses the secrets storage onDidChange event as a cross-window communication mechanism.
	 * Stores JSON with action, label, and timestamp to ensure the value always changes.
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
	 * The secrets storage onDidChange event fires across all windows, enabling cross-window sync.
	 * Parses JSON to extract action and label.
	 */
	public onDidChangeLoginState(
		listener: (state: AuthAction, label: string) => Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key === LOGIN_STATE_KEY) {
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
	 * Only fires when the session token actually changes for this deployment.
	 * OAuth token/registration changes will NOT trigger this listener.
	 */
	public onDidChangeDeploymentAuth(
		label: string,
		listener: (auth: SessionAuth | undefined) => void | Promise<void>,
	): Disposable {
		return this.onDidChangeSessionAuthMap(async (map) => {
			const auth = map[label];
			const newToken = auth?.sessionToken ?? "";
			const previousToken = this.previousSessionTokens.get(label) ?? "";

			// Only fire listener if session token actually changed
			if (newToken !== previousToken) {
				this.previousSessionTokens.set(label, newToken);
				await listener(auth);
			}
		});
	}

	/**
	 * Listen for changes to the session auth map across all deployments.
	 * Fires whenever any deployment's session auth is updated.
	 */
	private onDidChangeSessionAuthMap(
		listener: (map: SessionAuthMap) => void | Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== SESSION_AUTH_MAP_KEY) {
				return;
			}

			try {
				const map = await this.getSessionAuthMap();
				await listener(map);
			} catch {
				// Ignore errors in listener
			}
		});
	}

	/**
	 * Get session token for a specific deployment.
	 */
	public async getSessionToken(label: string): Promise<string | undefined> {
		const map = await this.getSessionAuthMap();
		return map[label]?.sessionToken;
	}

	/**
	 * Set session token for a specific deployment.
	 */
	public async setSessionToken(
		label: string,
		auth: { url: string; sessionToken: string } | undefined,
	): Promise<void> {
		await this.updateSessionAuthMap((map) => {
			if (auth === undefined) {
				const newMap = { ...map };
				delete newMap[label];
				return newMap;
			}

			return {
				...map,
				[label]: auth,
			};
		});
	}

	/**
	 * Get OAuth tokens for a specific deployment.
	 */
	public async getOAuthTokens(
		label: string,
	): Promise<StoredOAuthTokens | undefined> {
		const map = await this.getOAuthDataMap();
		return map[label]?.oauthTokens;
	}

	/**
	 * Set OAuth tokens for a specific deployment.
	 */
	public async setOAuthTokens(
		label: string,
		tokens: StoredOAuthTokens | undefined,
	): Promise<void> {
		await this.updateOAuthDataMap((map) => {
			const existing = map[label] || {};
			return {
				...map,
				[label]: {
					...existing,
					oauthTokens: tokens,
				},
			};
		});
	}

	/**
	 * Get OAuth client registration for a specific deployment.
	 */
	public async getOAuthClientRegistration(
		label: string,
	): Promise<ClientRegistrationResponse | undefined> {
		const map = await this.getOAuthDataMap();
		return map[label]?.oauthClientRegistration;
	}

	/**
	 * Set OAuth client registration for a specific deployment.
	 * Creates the OAuth data entry if it doesn't exist.
	 */
	public async setOAuthClientRegistration(
		label: string,
		registration: ClientRegistrationResponse | undefined,
	): Promise<void> {
		await this.updateOAuthDataMap((map) => {
			const existing = map[label] || {};
			return {
				...map,
				[label]: {
					...existing,
					oauthClientRegistration: registration,
				},
			};
		});
	}

	public async clearOAuthData(label: string): Promise<void> {
		await this.updateOAuthDataMap((map) => {
			const newMap = { ...map };
			delete newMap[label];
			return newMap;
		});
	}

	/**
	 * Get the session auth map for all deployments.
	 */
	private async getSessionAuthMap(): Promise<SessionAuthMap> {
		try {
			const data = await this.secrets.get(SESSION_AUTH_MAP_KEY);
			if (data) {
				return JSON.parse(data) as SessionAuthMap;
			}
		} catch {
			// Ignore parse errors
		}
		return {};
	}

	/**
	 * Set the session auth map for all deployments.
	 */
	private async setSessionAuthMap(map: SessionAuthMap): Promise<void> {
		await this.secrets.store(SESSION_AUTH_MAP_KEY, JSON.stringify(map));
	}

	/**
	 * Get the OAuth data map for all deployments.
	 */
	private async getOAuthDataMap(): Promise<OAuthDataMap> {
		try {
			const data = await this.secrets.get(OAUTH_DATA_MAP_KEY);
			if (data) {
				return JSON.parse(data) as OAuthDataMap;
			}
		} catch {
			// Ignore parse errors
		}
		return {};
	}

	/**
	 * Set the OAuth data map for all deployments.
	 */
	private async setOAuthDataMap(map: OAuthDataMap): Promise<void> {
		await this.secrets.store(OAUTH_DATA_MAP_KEY, JSON.stringify(map));
	}

	/**
	 * Promise used for synchronizing session auth map updates.
	 */
	private sessionAuthUpdatePromise: Promise<void> = Promise.resolve();

	/**
	 * Promise used for synchronizing OAuth data map updates.
	 */
	private oauthDataUpdatePromise: Promise<void> = Promise.resolve();

	/**
	 * Atomically update the session auth map using a synchronized updater function.
	 * All write operations should go through this method to prevent race conditions.
	 */
	private async updateSessionAuthMap(
		updater: (map: SessionAuthMap) => SessionAuthMap,
	): Promise<void> {
		this.sessionAuthUpdatePromise = this.sessionAuthUpdatePromise.then(
			async () => {
				const currentMap = await this.getSessionAuthMap();
				const newMap = updater(currentMap);
				await this.setSessionAuthMap(newMap);
			},
		);

		return this.sessionAuthUpdatePromise;
	}

	/**
	 * Atomically update the OAuth data map using a synchronized updater function.
	 * All write operations should go through this method to prevent race conditions.
	 */
	private async updateOAuthDataMap(
		updater: (map: OAuthDataMap) => OAuthDataMap,
	): Promise<void> {
		this.oauthDataUpdatePromise = this.oauthDataUpdatePromise.then(async () => {
			const currentMap = await this.getOAuthDataMap();
			const newMap = updater(currentMap);
			await this.setOAuthDataMap(newMap);
		});

		return this.oauthDataUpdatePromise;
	}

	/**
	 * Migrate from old flat storage format to new label-based format.
	 * This is a one-time operation that runs on extension activation.
	 *
	 * @param url The deployment URL to use for generating the label
	 * @returns true if migration was performed, false if already migrated or nothing to migrate
	 */
	public async migrateFromLegacyStorage(url: string): Promise<boolean> {
		try {
			// Check if already migrated (new map exists and has data)
			const existingMap = await this.getSessionAuthMap();
			if (Object.keys(existingMap).length > 0) {
				return false; // Already migrated
			}

			// Directly access old session token from flat storage
			const oldToken = await this.secrets.get(SESSION_TOKEN_KEY);
			if (!oldToken) {
				return false; // Nothing to migrate
			}

			// Generate label from URL
			const label = toSafeHost(url);

			// Create new session auth map with migrated token
			const sessionAuthMap: SessionAuthMap = {
				[label]: {
					url: url,
					sessionToken: oldToken,
				},
			};

			// Write new map to secrets
			await this.setSessionAuthMap(sessionAuthMap);

			// Delete old session token key
			await this.secrets.delete(SESSION_TOKEN_KEY);

			return true; // Migration successful
		} catch (error) {
			throw new Error(`Auth storage migration failed: ${error}`);
		}
	}
}
