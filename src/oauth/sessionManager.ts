import { CoderApi } from "../api/coderApi";
import { isSameOrigin } from "../common/url";
import { raceWithAbort, throwIfAborted } from "../error/abort";
import {
	AuthTelemetry,
	type AuthTokenRefreshTrigger,
} from "../instrumentation/auth";

import { DEFAULT_OAUTH_SCOPES, REFRESH_GRANT_TYPE } from "./constants";
import { OAuthError, parseOAuthError } from "./errors";
import { withOAuthMetadata } from "./metadataClient";
import { revokeOAuthTokens } from "./revocation";
import { buildOAuthTokenData, toUrlSearchParams } from "./tokens";
import { OAuth2TokenResponseSchema, parseOAuthResponse } from "./validation";

import type {
	OAuth2TokenRequest,
	OAuth2TokenResponse,
} from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { ServiceContainer } from "../container";
import type { Deployment } from "../deployment/types";
import type { Logger } from "../logging/logger";
import type { OAuthTokenData, SecretsManager } from "../storage/secretsManager";

/**
 * Token refresh threshold: refresh when token expires in less than this time.
 */
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Background token refresh check interval.
 */
const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Internal type combining access token with OAuth-specific data.
 * Used by getStoredTokens() for token refresh and validation.
 */
type StoredTokens = OAuthTokenData & {
	access_token: string;
};

/**
 * Manages OAuth session lifecycle for a Coder deployment.
 * Coordinates authorization flow, token management, and automatic refresh.
 */
export class OAuthSessionManager implements vscode.Disposable {
	private refreshPromise: Promise<OAuth2TokenResponse> | null = null;
	private refreshAbortController: AbortController | null = null;
	private refreshTimer: NodeJS.Timeout | undefined;
	private tokenChangeListener: vscode.Disposable | undefined;
	private disposed = false;

	/**
	 * Create and initialize a new OAuth session manager.
	 *
	 * @param onAuthRequired Called when background refresh fails with a re-auth error.
	 */
	public static create(
		deployment: Deployment | null,
		container: ServiceContainer,
		onAuthRequired: () => Promise<void> = () => Promise.resolve(),
	): OAuthSessionManager {
		const manager = new OAuthSessionManager(
			deployment,
			container.getSecretsManager(),
			container.getLogger(),
			onAuthRequired,
			new AuthTelemetry(container.getTelemetryService()),
		);
		manager.setupTokenListener();
		manager.scheduleNextRefresh();
		return manager;
	}

	private constructor(
		private deployment: Deployment | null,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		private readonly onAuthRequired: () => Promise<void>,
		private readonly authTelemetry: AuthTelemetry,
	) {}

	/**
	 * Get current deployment, throwing if not set.
	 * Use this in methods that require a deployment to be configured.
	 */
	private requireDeployment(): Deployment {
		if (!this.deployment) {
			throw new Error("No deployment configured for OAuth session manager");
		}
		return this.deployment;
	}

	/**
	 * Get stored tokens fresh from secrets manager.
	 * Always reads from storage to ensure cross-window synchronization.
	 * Returns undefined for tokens of another deployment origin.
	 */
	private async getStoredTokens(): Promise<StoredTokens | undefined> {
		if (!this.deployment) {
			return undefined;
		}

		const auth = await this.secretsManager.getSessionAuthForUrl(
			this.deployment.url,
		);
		if (!auth?.oauth) {
			return undefined;
		}

		return {
			access_token: auth.token,
			...auth.oauth,
		};
	}

	/** Stored tokens, or undefined when they lack a required scope. */
	private async getTokensWithRequiredScopes(): Promise<
		StoredTokens | undefined
	> {
		const storedTokens = await this.getStoredTokens();
		if (storedTokens && !this.hasRequiredScopes(storedTokens.scope)) {
			this.logger.warn("Stored tokens have insufficient scopes", {
				scope: storedTokens.scope,
			});
			return undefined;
		}
		return storedTokens;
	}

	/**
	 * Clear all refresh-related state: in-flight promise, timer, and listener.
	 * Aborts any in-flight refresh request to prevent stale token updates.
	 */
	private clearRefreshState(): void {
		this.refreshAbortController?.abort();
		this.refreshAbortController = null;
		this.refreshPromise = null;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		this.tokenChangeListener?.dispose();
		this.tokenChangeListener = undefined;
	}

	/**
	 * Setup listener for token changes. Disposes existing listener first.
	 * Reschedules refresh when tokens change (e.g., from another window).
	 */
	private setupTokenListener(): void {
		this.tokenChangeListener?.dispose();
		this.tokenChangeListener = undefined;

		if (!this.deployment) {
			return;
		}

		this.tokenChangeListener = this.secretsManager.onDidChangeSessionAuth(
			this.deployment.safeHostname,
			(auth) => {
				if (auth?.oauth) {
					this.scheduleNextRefresh();
				} else {
					this.clearRefreshState();
				}
			},
		);
	}

	/**
	 * Schedule the next token refresh based on expiry time.
	 * - Far from expiry: schedule once at threshold
	 * - Near/past expiry: attempt refresh immediately
	 */
	private scheduleNextRefresh(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}

		this.getTokensWithRequiredScopes()
			.then((storedTokens) => {
				if (!storedTokens?.refresh_token) {
					return;
				}

				const now = Date.now();
				const timeUntilExpiry = storedTokens.expiry_timestamp - now;

				if (timeUntilExpiry <= TOKEN_REFRESH_THRESHOLD_MS) {
					// Within threshold or expired, attempt refresh now
					this.attemptRefreshWithRetry();
				} else {
					// Schedule for when we reach the threshold
					const delay = timeUntilExpiry - TOKEN_REFRESH_THRESHOLD_MS;
					this.logger.debug(
						`Scheduling token refresh in ${Math.round(delay / 1000 / 60)} minutes`,
					);
					this.refreshTimer = setTimeout(
						() => this.attemptRefreshWithRetry(),
						delay,
					);
				}
			})
			.catch((error) => {
				this.logger.warn("Failed to schedule token refresh:", error);
			});
	}

	/**
	 * Attempt refresh, falling back to polling on failure.
	 */
	private attemptRefreshWithRetry(): void {
		if (this.disposed) {
			return;
		}

		this.refreshTimer = undefined;

		this.refreshToken("background")
			.then(() => {
				this.logger.debug("Background token refresh succeeded");
			})
			.catch(async (error) => {
				if (this.disposed) {
					return;
				}

				// Re-auth errors: notify callback and stop retrying
				if (error instanceof OAuthError && error.requiresReAuth) {
					this.logger.warn(
						"Background refresh requires re-auth:",
						error.message,
					);
					try {
						await this.onAuthRequired();
					} catch (callbackError) {
						this.logger.error("onAuthRequired callback failed:", callbackError);
					}
					return;
				}

				this.logger.warn("Background token refresh failed, will retry:", error);
				this.refreshTimer = setTimeout(
					() => this.attemptRefreshWithRetry(),
					BACKGROUND_REFRESH_INTERVAL_MS,
				);
			});
	}

	/**
	 * Check if granted scopes cover all required scopes.
	 * Supports wildcard scopes like "workspace:*".
	 */
	private hasRequiredScopes(grantedScope: string): boolean {
		const grantedScopes = new Set(grantedScope.split(" "));
		if (grantedScopes.has("coder:all")) {
			return true;
		}
		const requiredScopes = DEFAULT_OAUTH_SCOPES.split(" ");

		for (const required of requiredScopes) {
			if (grantedScopes.has(required)) {
				continue;
			}

			// Check wildcard match (e.g., "workspace:*" grants "workspace:read")
			const colonIndex = required.indexOf(":");
			if (colonIndex !== -1) {
				const prefix = required.substring(0, colonIndex);
				const wildcard = `${prefix}:*`;
				if (grantedScopes.has(wildcard)) {
					continue;
				}
			}

			return false;
		}

		return true;
	}

	public async setDeployment(deployment: Deployment): Promise<void> {
		if (deployment === this.deployment) {
			return;
		}
		this.deployment = deployment;
		this.clearRefreshState();

		const storedTokens = await this.getTokensWithRequiredScopes();
		if (storedTokens) {
			this.logger.debug("Switching OAuth deployment", deployment);
		}

		// Block on refresh if token is expired to ensure valid state for callers
		if (storedTokens && Date.now() >= storedTokens.expiry_timestamp) {
			try {
				await this.refreshToken();
			} catch (error) {
				this.logger.warn("Token refresh failed (expired):", error);
			}
		}

		// Schedule after blocking refresh to avoid concurrent attempts
		this.setupTokenListener();
		this.scheduleNextRefresh();
	}

	public clearDeployment(): void {
		this.deployment = null;
		this.clearRefreshState();
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 * Uses a shared promise to handle concurrent refresh attempts.
	 */
	public async refreshToken(
		trigger: AuthTokenRefreshTrigger = "reactive",
	): Promise<OAuth2TokenResponse> {
		if (this.refreshPromise) {
			this.logger.debug(
				"Token refresh already in progress, waiting for result",
			);
			this.authTelemetry.logTokenRefreshDeduped(trigger);
			return this.refreshPromise;
		}

		const deployment = this.requireDeployment();
		// Assign synchronously before any async work to prevent race conditions
		this.refreshPromise = this.authTelemetry.traceTokenRefresh(trigger, () =>
			this.executeTokenRefresh(deployment),
		);
		return this.refreshPromise;
	}

	private async executeTokenRefresh(
		deployment: Deployment,
	): Promise<OAuth2TokenResponse> {
		const abortController = new AbortController();
		this.refreshAbortController = abortController;

		try {
			const storedTokens = await this.getTokensWithRequiredScopes();
			throwIfAborted(abortController.signal);
			if (!storedTokens?.refresh_token) {
				throw new Error("No refresh token available");
			}

			const refreshToken = storedTokens.refresh_token;
			const registration =
				storedTokens.registration ??
				(await this.secretsManager.getOAuthClientRegistration(
					deployment.safeHostname,
				));
			if (!registration) {
				throw new Error("No client registration found");
			}

			return await withOAuthMetadata(
				deployment.url,
				storedTokens.access_token,
				this.logger,
				async ({ axiosInstance, metadata }) => {
					this.logger.debug("Refreshing access token");

					const params: OAuth2TokenRequest = {
						grant_type: REFRESH_GRANT_TYPE,
						refresh_token: refreshToken,
						client_id: registration.client_id,
						client_secret: registration.client_secret,
					};

					const response = await axiosInstance.post<OAuth2TokenResponse>(
						metadata.token_endpoint,
						toUrlSearchParams(params),
						{
							headers: {
								"Content-Type": "application/x-www-form-urlencoded",
							},
							signal: abortController.signal,
						},
					);

					if (abortController.signal.aborted) {
						throw new Error("Token refresh aborted");
					}

					this.logger.debug("Token refresh successful");

					const tokenResponse = parseOAuthResponse(
						OAuth2TokenResponseSchema,
						response.data,
						metadata.token_endpoint,
					);

					const username = await this.fetchUsername(
						deployment,
						tokenResponse.access_token,
						abortController.signal,
					);
					throwIfAborted(abortController.signal);
					await this.secretsManager.setSessionAuth(deployment.safeHostname, {
						url: deployment.url,
						token: tokenResponse.access_token,
						username,
						oauth: buildOAuthTokenData(tokenResponse, registration),
					});

					return tokenResponse;
				},
			);
		} catch (error) {
			throw parseOAuthError(error) ?? error;
		} finally {
			if (this.refreshAbortController === abortController) {
				this.refreshAbortController = null;
				this.refreshPromise = null;
			}
		}
	}

	/**
	 * Ask the deployment who the token belongs to, falling back to the stored
	 * username so a failed lookup cannot fail the refresh.
	 */
	private async fetchUsername(
		deployment: Deployment,
		accessToken: string,
		signal: AbortSignal,
	): Promise<string | undefined> {
		const client = CoderApi.create(deployment.url, accessToken, this.logger);
		try {
			throwIfAborted(signal);
			return (await raceWithAbort(client.getAuthenticatedUser(), signal))
				.username;
		} catch (error) {
			throwIfAborted(signal);
			this.logger.warn("Failed to fetch the user after token refresh:", error);
			const auth = await this.secretsManager.getSessionAuthForUrl(
				deployment.url,
			);
			return auth?.username;
		} finally {
			client.dispose();
		}
	}

	/** Best-effort server-side revocation of the stored refresh and access tokens; never throws. */
	public async revokeTokens(): Promise<void> {
		const deployment = this.deployment;
		if (!deployment) {
			return;
		}
		// Includes tokens lacking a required scope, which still work on the server.
		const auth = await this.secretsManager.getSessionAuthForUrl(deployment.url);
		if (!auth) {
			return;
		}
		const registration = await this.secretsManager.getOAuthClientRegistration(
			deployment.safeHostname,
		);
		await revokeOAuthTokens(auth, registration, this.logger);
	}

	/**
	 * Whether the deployment's OAuth tokens carry every required scope, so they
	 * may refresh. Reads secrets each time to stay in sync across windows.
	 *
	 * @param url Returns false if not the current deployment's origin (race-safety).
	 */
	public async canRefreshOAuthSession(url?: string): Promise<boolean> {
		if (url && this.deployment && !isSameOrigin(url, this.deployment.url)) {
			return false;
		}
		const storedTokens = await this.getTokensWithRequiredScopes();
		return storedTokens !== undefined;
	}

	/**
	 * Clears all in-memory state.
	 */
	public dispose(): void {
		this.disposed = true;
		this.clearDeployment();
	}
}
