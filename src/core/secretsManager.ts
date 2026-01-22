import { z } from "zod";

import { DeploymentSchema, type Deployment } from "../deployment/types";
import { toSafeHost } from "../util";

import type { OAuth2ClientRegistrationResponse } from "coder/site/src/api/typesGenerated";
import type { Memento, SecretStorage, Disposable } from "vscode";

import type { Logger } from "../logging/logger";

// Per-deployment keys ensure atomic operations (multiple windows writing to a
// shared key could drop data) and enable proper VS Code change events.
const SESSION_KEY_PREFIX = "coder.session.";
const OAUTH_CLIENT_PREFIX = "coder.oauth.client.";
const DEPLOYMENT_ACCESS_PREFIX = "coder.access.";

type SecretKeyPrefix = typeof SESSION_KEY_PREFIX | typeof OAUTH_CLIENT_PREFIX;

const OAUTH_CALLBACK_KEY = "coder.oauthCallback";
const CURRENT_DEPLOYMENT_KEY = "coder.currentDeployment";
const DEFAULT_MAX_DEPLOYMENTS = 10;

const LEGACY_SESSION_TOKEN_KEY = "sessionToken";

const CurrentDeploymentStateSchema = z.object({
	deployment: DeploymentSchema.nullable(),
});

export type CurrentDeploymentState = z.infer<
	typeof CurrentDeploymentStateSchema
>;

/**
 * OAuth token data stored alongside session auth.
 * When present, indicates the session is authenticated via OAuth.
 */
const OAuthTokenDataSchema = z.object({
	refresh_token: z.string().optional(),
	scope: z.string(),
	expiry_timestamp: z.number(),
});

export type OAuthTokenData = z.infer<typeof OAuthTokenDataSchema>;

const SessionAuthSchema = z.object({
	url: z.string(),
	token: z.string(),
	/** If present, this session uses OAuth authentication */
	oauth: OAuthTokenDataSchema.optional(),
});

export type SessionAuth = z.infer<typeof SessionAuthSchema>;

const OAuthCallbackDataSchema = z.object({
	state: z.string(),
	code: z.string().nullable(),
	error: z.string().nullable(),
});

type OAuthCallbackData = z.infer<typeof OAuthCallbackDataSchema>;

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
		const state = CurrentDeploymentStateSchema.parse({
			deployment: deployment ?? null,
		});
		// Add timestamp for cross-window change detection
		const stateWithTimestamp = {
			...state,
			timestamp: new Date().toISOString(),
		};
		await this.secrets.store(
			CURRENT_DEPLOYMENT_KEY,
			JSON.stringify(stateWithTimestamp),
		);
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
			const parsed: unknown = JSON.parse(data);
			const result = CurrentDeploymentStateSchema.safeParse(parsed);
			return result.success ? result.data.deployment : null;
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

	public async getSessionAuth(
		safeHostname: string,
	): Promise<SessionAuth | undefined> {
		const data = await this.getSecret<unknown>(
			SESSION_KEY_PREFIX,
			safeHostname,
		);
		if (!data) {
			return undefined;
		}
		const result = SessionAuthSchema.safeParse(data);
		return result.success ? result.data : undefined;
	}

	public async setSessionAuth(
		safeHostname: string,
		auth: SessionAuth,
	): Promise<void> {
		// Parse through schema to strip any extra fields
		const state = SessionAuthSchema.parse(auth);
		await this.setSecret(SESSION_KEY_PREFIX, safeHostname, state);
	}

	private clearSessionAuth(safeHostname: string): Promise<void> {
		return this.clearSecret(SESSION_KEY_PREFIX, safeHostname);
	}

	/**
	 * Record that a deployment was accessed by updating its timestamp.
	 * Prunes deployments beyond maxCount, clearing their auth data.
	 */
	public async recordDeploymentAccess(
		safeHostname: string,
		maxCount = DEFAULT_MAX_DEPLOYMENTS,
	): Promise<void> {
		// Update this deployment's access timestamp
		await this.memento.update(
			`${DEPLOYMENT_ACCESS_PREFIX}${safeHostname}`,
			new Date().toISOString(),
		);

		// Prune if needed - errors here shouldn't block deployment access
		try {
			const allHostnames = await this.getKnownSafeHostnames();
			const toRemove = allHostnames.slice(maxCount);
			await Promise.all(toRemove.map((h) => this.clearAllAuthData(h)));
		} catch {
			this.logger.warn("Failed to prune old deployments");
		}
	}

	/**
	 * Clear all auth data for a deployment, including the access timestamp.
	 */
	public async clearAllAuthData(safeHostname: string): Promise<void> {
		await Promise.all([
			this.clearSessionAuth(safeHostname),
			this.clearOAuthClientRegistration(safeHostname),
			this.memento.update(
				`${DEPLOYMENT_ACCESS_PREFIX}${safeHostname}`,
				undefined,
			),
		]);
	}

	/**
	 * Get all known hostnames, ordered by most recently accessed.
	 * Derives the list from actual session secrets stored.
	 */
	public async getKnownSafeHostnames(): Promise<string[]> {
		const keys = await this.secrets.keys();
		const sessionHostnames = keys
			.filter((k) => k.startsWith(SESSION_KEY_PREFIX))
			.map((k) => k.slice(SESSION_KEY_PREFIX.length));

		// Sort by access timestamp (most recent first)
		const withTimestamps = sessionHostnames.map((hostname) => ({
			hostname,
			accessedAt:
				this.memento.get<string>(`${DEPLOYMENT_ACCESS_PREFIX}${hostname}`) ??
				"",
		}));

		withTimestamps.sort((a, b) => b.accessedAt.localeCompare(a.accessedAt));
		return withTimestamps.map((w) => w.hostname);
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
		const parsed = OAuthCallbackDataSchema.parse(data);
		await this.secrets.store(OAUTH_CALLBACK_KEY, JSON.stringify(parsed));
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

			const raw = await this.secrets.get(OAUTH_CALLBACK_KEY);
			if (!raw) {
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				this.logger.error("Failed to parse OAuth callback JSON", err);
				return;
			}

			const result = OAuthCallbackDataSchema.safeParse(parsed);
			if (!result.success) {
				this.logger.error("Invalid OAuth callback data shape", result.error);
				return;
			}

			try {
				listener(result.data);
			} catch (err) {
				this.logger.error("Error in onDidChangeOAuthCallback listener", err);
			}
		});
	}

	public getOAuthClientRegistration(
		safeHostname: string,
	): Promise<OAuth2ClientRegistrationResponse | undefined> {
		return this.getSecret<OAuth2ClientRegistrationResponse>(
			OAUTH_CLIENT_PREFIX,
			safeHostname,
		);
	}

	public setOAuthClientRegistration(
		safeHostname: string,
		registration: OAuth2ClientRegistrationResponse,
	): Promise<void> {
		return this.setSecret(OAUTH_CLIENT_PREFIX, safeHostname, registration);
	}

	public clearOAuthClientRegistration(safeHostname: string): Promise<void> {
		return this.clearSecret(OAUTH_CLIENT_PREFIX, safeHostname);
	}
}
