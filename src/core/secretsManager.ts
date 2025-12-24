import { type Logger } from "../logging/logger";
import { type ClientRegistrationResponse } from "../oauth/types";
import { toSafeHost } from "../util";

import type { Memento, SecretStorage, Disposable } from "vscode";

import type { Deployment } from "../deployment/types";

// Each deployment has its own key to ensure atomic operations (multiple windows
// writing to a shared key could drop data) and to receive proper VS Code events.
const SESSION_KEY_PREFIX = "coder.session." as const;
const OAUTH_CLIENT_PREFIX = "coder.oauth.client." as const;

type SecretKeyPrefix = typeof SESSION_KEY_PREFIX | typeof OAUTH_CLIENT_PREFIX;

const OAUTH_CALLBACK_KEY = "coder.oauthCallback";

const CURRENT_DEPLOYMENT_KEY = "coder.currentDeployment";

const DEPLOYMENT_USAGE_KEY = "coder.deploymentUsage";
const DEFAULT_MAX_DEPLOYMENTS = 10;

const LEGACY_SESSION_TOKEN_KEY = "sessionToken";

export interface CurrentDeploymentState {
	deployment: Deployment | null;
}

/**
 * OAuth token data stored alongside session auth.
 * When present, indicates the session is authenticated via OAuth.
 */
export interface OAuthTokenData {
	token_type: "Bearer";
	refresh_token?: string;
	scope?: string;
	expiry_timestamp: number;
}

export interface SessionAuth {
	url: string;
	token: string;
	/** If present, this session uses OAuth authentication */
	oauth?: OAuthTokenData;
}

// Tracks when a deployment was last accessed for LRU pruning.
interface DeploymentUsage {
	safeHostname: string;
	lastAccessedAt: string;
}

interface OAuthCallbackData {
	state: string;
	code: string | null;
	error: string | null;
}

export class SecretsManager {
	constructor(
		private readonly secrets: SecretStorage,
		private readonly memento: Memento,
		private readonly logger: Logger,
	) {}

	private buildKey(prefix: SecretKeyPrefix, safeHostname: string): string {
		return `${prefix}${safeHostname || "<legacy>"}`;
	}

	private async getSecret<T>(
		prefix: SecretKeyPrefix,
		safeHostname: string,
	): Promise<T | undefined> {
		try {
			const data = await this.secrets.get(this.buildKey(prefix, safeHostname));
			if (!data) {
				return undefined;
			}
			return JSON.parse(data) as T;
		} catch {
			return undefined;
		}
	}

	private async setSecret<T>(
		prefix: SecretKeyPrefix,
		safeHostname: string,
		value: T,
	): Promise<void> {
		await this.secrets.store(
			this.buildKey(prefix, safeHostname),
			JSON.stringify(value),
		);
		await this.recordDeploymentAccess(safeHostname);
	}

	private async clearSecret(
		prefix: SecretKeyPrefix,
		safeHostname: string,
	): Promise<void> {
		await this.secrets.delete(this.buildKey(prefix, safeHostname));
	}

	/**
	 * Sets the current deployment and triggers a cross-window sync event.
	 */
	public async setCurrentDeployment(
		deployment: Deployment | undefined,
	): Promise<void> {
		const state: CurrentDeploymentState & { timestamp: string } = {
			// Extract the necessary fields before serializing
			deployment: deployment
				? {
						url: deployment?.url,
						safeHostname: deployment?.safeHostname,
					}
				: null,
			timestamp: new Date().toISOString(),
		};
		await this.secrets.store(CURRENT_DEPLOYMENT_KEY, JSON.stringify(state));
	}

	/**
	 * Gets the current deployment from storage.
	 */
	public async getCurrentDeployment(): Promise<Deployment | null> {
		try {
			const data = await this.secrets.get(CURRENT_DEPLOYMENT_KEY);
			if (!data) {
				return null;
			}
			const parsed = JSON.parse(data) as CurrentDeploymentState;
			return parsed.deployment;
		} catch {
			return null;
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

			const deployment = await this.getCurrentDeployment();
			try {
				await listener({ deployment });
			} catch (err) {
				this.logger.error(
					"Error in onDidChangeCurrentDeployment listener",
					err,
				);
			}
		});
	}

	/**
	 * Listen for changes to a specific deployment's session auth.
	 */
	public onDidChangeSessionAuth(
		safeHostname: string,
		listener: (auth: SessionAuth | undefined) => void | Promise<void>,
	): Disposable {
		const sessionKey = this.buildKey(SESSION_KEY_PREFIX, safeHostname);
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== sessionKey) {
				return;
			}
			const auth = await this.getSessionAuth(safeHostname);
			try {
				await listener(auth);
			} catch (err) {
				this.logger.error("Error in onDidChangeSessionAuth listener", err);
			}
		});
	}

	public getSessionAuth(
		safeHostname: string,
	): Promise<SessionAuth | undefined> {
		return this.getSecret<SessionAuth>(SESSION_KEY_PREFIX, safeHostname);
	}

	public async setSessionAuth(
		safeHostname: string,
		auth: SessionAuth,
	): Promise<void> {
		// Extract relevant fields before serializing
		const state: SessionAuth = {
			url: auth.url,
			token: auth.token,
			...(auth.oauth && { oauth: auth.oauth }),
		};
		await this.setSecret(SESSION_KEY_PREFIX, safeHostname, state);
	}

	private clearSessionAuth(safeHostname: string): Promise<void> {
		return this.clearSecret(SESSION_KEY_PREFIX, safeHostname);
	}

	/**
	 * Record that a deployment was accessed, moving it to the front of the LRU list.
	 * Prunes deployments beyond maxCount, clearing their auth data.
	 */
	public async recordDeploymentAccess(
		safeHostname: string,
		maxCount = DEFAULT_MAX_DEPLOYMENTS,
	): Promise<void> {
		const usage = this.getDeploymentUsage();
		const filtered = usage.filter((u) => u.safeHostname !== safeHostname);
		filtered.unshift({
			safeHostname,
			lastAccessedAt: new Date().toISOString(),
		});

		const toKeep = filtered.slice(0, maxCount);
		const toRemove = filtered.slice(maxCount);

		await Promise.all(
			toRemove.map((u) => this.clearAllAuthData(u.safeHostname)),
		);
		await this.memento.update(DEPLOYMENT_USAGE_KEY, toKeep);
	}

	/**
	 * Clear all auth data for a deployment and remove it from the usage list.
	 */
	public async clearAllAuthData(safeHostname: string): Promise<void> {
		await Promise.all([
			this.clearSessionAuth(safeHostname),
			this.clearOAuthClientRegistration(safeHostname),
		]);
		const usage = this.getDeploymentUsage().filter(
			(u) => u.safeHostname !== safeHostname,
		);
		await this.memento.update(DEPLOYMENT_USAGE_KEY, usage);
	}

	/**
	 * Get all known hostnames, ordered by most recently accessed.
	 */
	public getKnownSafeHostnames(): string[] {
		return this.getDeploymentUsage().map((u) => u.safeHostname);
	}

	/**
	 * Get the full deployment usage list with access timestamps.
	 */
	private getDeploymentUsage(): DeploymentUsage[] {
		return this.memento.get<DeploymentUsage[]>(DEPLOYMENT_USAGE_KEY) ?? [];
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

		const oldToken = await this.secrets.get(LEGACY_SESSION_TOKEN_KEY);

		await this.secrets.delete(LEGACY_SESSION_TOKEN_KEY);
		await this.memento.update("url", undefined);

		const safeHostname = toSafeHost(legacyUrl);
		const existing = await this.getSessionAuth(safeHostname);
		if (!existing) {
			await this.setSessionAuth(safeHostname, {
				url: legacyUrl,
				token: oldToken ?? "",
			});
		}

		// Also set as current deployment if none exists
		const currentDeployment = await this.getCurrentDeployment();
		if (!currentDeployment) {
			await this.setCurrentDeployment({ url: legacyUrl, safeHostname });
		}

		return safeHostname;
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

	public getOAuthClientRegistration(
		safeHostname: string,
	): Promise<ClientRegistrationResponse | undefined> {
		return this.getSecret<ClientRegistrationResponse>(
			OAUTH_CLIENT_PREFIX,
			safeHostname,
		);
	}

	public setOAuthClientRegistration(
		safeHostname: string,
		registration: ClientRegistrationResponse,
	): Promise<void> {
		return this.setSecret(OAUTH_CLIENT_PREFIX, safeHostname, registration);
	}

	public clearOAuthClientRegistration(safeHostname: string): Promise<void> {
		return this.clearSecret(OAUTH_CLIENT_PREFIX, safeHostname);
	}
}
