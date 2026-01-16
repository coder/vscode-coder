import { CoderApi } from "../api/coderApi";

import { DEFAULT_OAUTH_SCOPES, REFRESH_GRANT_TYPE } from "./constants";
import { OAuthError, parseOAuthError } from "./errors";
import { OAuthMetadataClient } from "./metadataClient";
import { buildOAuthTokenData, toUrlSearchParams } from "./utils";

import type { AxiosInstance } from "axios";
import type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ClientRegistrationResponse,
	OAuth2TokenRequest,
	OAuth2TokenResponse,
	OAuth2TokenRevocationRequest,
} from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { ServiceContainer } from "../core/container";
import type { OAuthTokenData, SecretsManager } from "../core/secretsManager";
import type { Deployment } from "../deployment/types";
import type { Logger } from "../logging/logger";

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
	 * Validates that tokens match current deployment URL and have required scopes.
	 * Invalid tokens are cleared and undefined is returned.
	 */
	private async getStoredTokens(): Promise<StoredTokens | undefined> {
		if (!this.deployment) {
			return undefined;
		}

		const auth = await this.secretsManager.getSessionAuth(
			this.deployment.safeHostname,
		);
		if (!auth?.oauth) {
			return undefined;
		}

		// Validate deployment URL matches
		if (auth.url !== this.deployment.url) {
			this.logger.warn("Stored tokens have mismatched deployment URL", {
				stored: auth.url,
				current: this.deployment.url,
			});
			return undefined;
		}

		if (!this.hasRequiredScopes(auth.oauth.scope)) {
			this.logger.warn("Stored tokens have insufficient scopes", {
				scope: auth.oauth.scope,
			});
			return undefined;
		}

		return {
			access_token: auth.token,
			...auth.oauth,
		};
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

		this.getStoredTokens()
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

		this.refreshToken()
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

	/**
	 * Prepare common OAuth operation setup: client, metadata, and registration.
	 * Used by refresh and revoke operations to reduce duplication.
	 */
	private async prepareOAuthOperation(token?: string): Promise<{
		axiosInstance: AxiosInstance;
		metadata: OAuth2AuthorizationServerMetadata;
		registration: OAuth2ClientRegistrationResponse;
	}> {
		const deployment = this.requireDeployment();
		const client = CoderApi.create(deployment.url, token, this.logger);
		const axiosInstance = client.getAxiosInstance();

		const metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
		const metadata = await metadataClient.getMetadata();

		const registration = await this.secretsManager.getOAuthClientRegistration(
			deployment.safeHostname,
		);
		if (!registration) {
			throw new Error("No client registration found");
		}

		return { axiosInstance, metadata, registration };
	}

	public async setDeployment(deployment: Deployment): Promise<void> {
		if (
			deployment.safeHostname === this.deployment?.safeHostname &&
			deployment.url === this.deployment.url
		) {
			return;
		}
		this.logger.debug("Switching OAuth deployment", deployment);
		this.deployment = deployment;
		this.clearRefreshState();

		// Block on refresh if token is expired to ensure valid state for callers
		const storedTokens = await this.getStoredTokens();
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
		this.logger.debug("Clearing OAuth deployment state");
		this.deployment = null;
		this.clearRefreshState();
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 * Uses a shared promise to handle concurrent refresh attempts.
	 */
	public async refreshToken(): Promise<OAuth2TokenResponse> {
		if (this.refreshPromise) {
			this.logger.debug(
				"Token refresh already in progress, waiting for result",
			);
			return this.refreshPromise;
		}

		const deployment = this.requireDeployment();
		// Assign synchronously before any async work to prevent race conditions
		this.refreshPromise = this.executeTokenRefresh(deployment);
		return this.refreshPromise;
	}

	private async executeTokenRefresh(
		deployment: Deployment,
	): Promise<OAuth2TokenResponse> {
		const abortController = new AbortController();
		this.refreshAbortController = abortController;

		try {
			const storedTokens = await this.getStoredTokens();
			if (!storedTokens?.refresh_token) {
				throw new Error("No refresh token available");
			}

			const refreshToken = storedTokens.refresh_token;
			const accessToken = storedTokens.access_token;

			const { axiosInstance, metadata, registration } =
				await this.prepareOAuthOperation(accessToken);

			this.logger.debug("Refreshing access token");

			const params: OAuth2TokenRequest = {
				grant_type: REFRESH_GRANT_TYPE,
				refresh_token: refreshToken,
				client_id: registration.client_id,
				client_secret: registration.client_secret,
			};

			const tokenRequest = toUrlSearchParams(params);

			const response = await axiosInstance.post<OAuth2TokenResponse>(
				metadata.token_endpoint,
				tokenRequest,
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					signal: abortController.signal,
				},
			);

			// Check if aborted between response and save
			if (abortController.signal.aborted) {
				throw new Error("Token refresh aborted");
			}

			this.logger.debug("Token refresh successful");

			const oauthData = buildOAuthTokenData(response.data);
			await this.secretsManager.setSessionAuth(deployment.safeHostname, {
				url: deployment.url,
				token: response.data.access_token,
				oauth: oauthData,
			});

			return response.data;
		} catch (error) {
			throw parseOAuthError(error) ?? error;
		} finally {
			if (this.refreshAbortController === abortController) {
				this.refreshAbortController = null;
			}
			this.refreshPromise = null;
		}
	}

	public async revokeRefreshToken(): Promise<void> {
		const storedTokens = await this.getStoredTokens();
		if (!storedTokens?.refresh_token) {
			this.logger.info("No refresh token to revoke");
			return;
		}

		await this.revokeToken(
			storedTokens.access_token,
			storedTokens.refresh_token,
			"refresh_token",
		);
	}

	/**
	 * Revoke a token using the OAuth server's revocation endpoint.
	 *
	 * @param authToken - Token for authenticating the revocation request
	 * @param tokenToRevoke - The token to be revoked
	 * @param tokenTypeHint - Hint about the token type being revoked
	 */
	private async revokeToken(
		authToken: string,
		tokenToRevoke: string,
		tokenTypeHint: "access_token" | "refresh_token" = "refresh_token",
	): Promise<void> {
		const { axiosInstance, metadata, registration } =
			await this.prepareOAuthOperation(authToken);

		if (!metadata.revocation_endpoint) {
			this.logger.info("No revocation endpoint available, skipping revocation");
			return;
		}

		this.logger.info("Revoking refresh token");

		const params: OAuth2TokenRevocationRequest = {
			token: tokenToRevoke,
			client_id: registration.client_id,
			client_secret: registration.client_secret,
			token_type_hint: tokenTypeHint,
		};

		const revocationRequest = toUrlSearchParams(params);

		try {
			await axiosInstance.post(
				metadata.revocation_endpoint,
				revocationRequest,
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				},
			);

			this.logger.info("Token revocation successful");
		} catch (error) {
			this.logger.error("Token revocation failed:", error);
			throw error;
		}
	}

	/**
	 * Returns true if OAuth tokens exist for the current deployment.
	 * Always reads fresh from secrets to ensure cross-window synchronization.
	 *
	 * @param hostname Optional hostname to validate against current deployment.
	 *                 If provided and doesn't match, returns false (race-safety).
	 */
	public async isLoggedInWithOAuth(hostname?: string): Promise<boolean> {
		if (hostname && hostname !== this.deployment?.safeHostname) {
			return false;
		}
		const storedTokens = await this.getStoredTokens();
		return storedTokens !== undefined;
	}

	/**
	 * Clears all in-memory state.
	 */
	public dispose(): void {
		this.disposed = true;
		this.clearDeployment();
		this.logger.debug("OAuth session manager disposed");
	}
}
