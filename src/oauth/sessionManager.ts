import { type AxiosInstance } from "axios";
import { type User } from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { type ServiceContainer } from "../core/container";
import {
	type OAuthTokenData,
	type SecretsManager,
	type SessionAuth,
} from "../core/secretsManager";
import { type Deployment } from "../deployment/types";
import { type Logger } from "../logging/logger";
import { type LoginCoordinator } from "../login/loginCoordinator";

import {
	type OAuthError,
	parseOAuthError,
	requiresReAuthentication,
} from "./errors";
import { OAuthMetadataClient } from "./metadataClient";
import {
	CALLBACK_PATH,
	generatePKCE,
	generateState,
	toUrlSearchParams,
} from "./utils";

import type {
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	OAuthServerMetadata,
	RefreshTokenRequestParams,
	TokenRequestParams,
	TokenResponse,
	TokenRevocationRequest,
} from "./types";

const AUTH_GRANT_TYPE = "authorization_code";
const REFRESH_GRANT_TYPE = "refresh_token";
const RESPONSE_TYPE = "code";
const PKCE_CHALLENGE_METHOD = "S256";

/**
 * Token refresh threshold: refresh when token expires in less than this time.
 */
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Default expiry time for OAuth access tokens when the server doesn't provide one.
 */
const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Minimum time between refresh attempts to prevent thrashing.
 */
const REFRESH_THROTTLE_MS = 30 * 1000;

/**
 * Background token refresh check interval.
 */
const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Minimal scopes required by the VS Code extension.
 */
const DEFAULT_OAUTH_SCOPES = [
	"workspace:read",
	"workspace:update",
	"workspace:start",
	"workspace:ssh",
	"workspace:application_connect",
	"template:read",
	"user:read_personal",
].join(" ");

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
	private refreshPromise: Promise<TokenResponse> | null = null;
	private lastRefreshAttempt = 0;
	private refreshTimer: NodeJS.Timeout | undefined;
	private tokenChangeListener: vscode.Disposable | undefined;

	private pendingAuthReject: ((reason: Error) => void) | undefined;

	/**
	 * Create and initialize a new OAuth session manager.
	 */
	public static create(
		deployment: Deployment | null,
		container: ServiceContainer,
		extensionId: string,
	): OAuthSessionManager {
		const manager = new OAuthSessionManager(
			deployment,
			container.getSecretsManager(),
			container.getLogger(),
			container.getLoginCoordinator(),
			extensionId,
		);
		manager.setupTokenListener();
		manager.scheduleNextRefresh();
		return manager;
	}

	private constructor(
		private deployment: Deployment | null,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		private readonly loginCoordinator: LoginCoordinator,
		private readonly extensionId: string,
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
			this.logger.warn(
				"Stored tokens have mismatched deployment URL, clearing OAuth",
				{ stored: auth.url, current: this.deployment.url },
			);
			await this.clearOAuthFromSessionAuth(auth);
			return undefined;
		}

		if (!this.hasRequiredScopes(auth.oauth.scope)) {
			this.logger.warn("Stored tokens have insufficient scopes, clearing", {
				scope: auth.oauth.scope,
			});
			await this.clearOAuthFromSessionAuth(auth);
			return undefined;
		}

		return {
			access_token: auth.token,
			...auth.oauth,
		};
	}

	/**
	 * Clear OAuth data from session auth while preserving the session token.
	 */
	private async clearOAuthFromSessionAuth(auth: SessionAuth): Promise<void> {
		if (!this.deployment) {
			return;
		}
		await this.secretsManager.setSessionAuth(this.deployment.safeHostname, {
			url: auth.url,
			token: auth.token,
		});
	}

	/**
	 * Clear all refresh-related state: in-flight promise, throttle, timer, and listener.
	 */
	private clearRefreshState(): void {
		this.refreshPromise = null;
		this.lastRefreshAttempt = 0;
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
		this.refreshTimer = undefined;

		this.refreshToken()
			.then(() => {
				// Success - scheduleNextRefresh will be triggered by token change listener
				this.logger.debug("Background token refresh succeeded");
			})
			.catch((error) => {
				this.logger.warn("Background token refresh failed, will retry:", error);
				// Fall back to polling until successful
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
	private hasRequiredScopes(grantedScope: string | undefined): boolean {
		if (!grantedScope) {
			// TODO server always returns empty scopes
			return true;
		}

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
	 * Get the redirect URI for OAuth callbacks.
	 */
	private getRedirectUri(): string {
		return `${vscode.env.uriScheme}://${this.extensionId}${CALLBACK_PATH}`;
	}

	/**
	 * Prepare common OAuth operation setup: client, metadata, and registration.
	 * Used by refresh and revoke operations to reduce duplication.
	 */
	private async prepareOAuthOperation(token?: string): Promise<{
		axiosInstance: AxiosInstance;
		metadata: OAuthServerMetadata;
		registration: ClientRegistrationResponse;
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

	/**
	 * Register OAuth client or return existing if still valid.
	 * Re-registers if redirect URI has changed.
	 */
	private async registerClient(
		axiosInstance: AxiosInstance,
		metadata: OAuthServerMetadata,
	): Promise<ClientRegistrationResponse> {
		const deployment = this.requireDeployment();
		const redirectUri = this.getRedirectUri();

		const existing = await this.secretsManager.getOAuthClientRegistration(
			deployment.safeHostname,
		);
		if (existing?.client_id) {
			if (existing.redirect_uris.includes(redirectUri)) {
				this.logger.info(
					"Using existing client registration:",
					existing.client_id,
				);
				return existing;
			}
			this.logger.info("Redirect URI changed, re-registering client");
		}

		if (!metadata.registration_endpoint) {
			throw new Error("Server does not support dynamic client registration");
		}

		try {
			const registrationRequest: ClientRegistrationRequest = {
				redirect_uris: [redirectUri],
				application_type: "web",
				grant_types: ["authorization_code"],
				response_types: ["code"],
				client_name: "VS Code Coder Extension",
				token_endpoint_auth_method: "client_secret_post",
			};

			const response = await axiosInstance.post<ClientRegistrationResponse>(
				metadata.registration_endpoint,
				registrationRequest,
			);

			await this.secretsManager.setOAuthClientRegistration(
				deployment.safeHostname,
				response.data,
			);
			this.logger.info(
				"Saved OAuth client registration:",
				response.data.client_id,
			);

			return response.data;
		} catch (error) {
			this.handleOAuthError(error);
			throw error;
		}
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
	 * OAuth login flow that handles the entire process.
	 * Fetches metadata, registers client, starts authorization, and exchanges tokens.
	 */
	public async login(
		deployment: Deployment,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		cancellationToken: vscode.CancellationToken,
	): Promise<{ token: string; user: User }> {
		const reportProgress = (message?: string, increment?: number): void => {
			if (cancellationToken.isCancellationRequested) {
				throw new Error("OAuth login cancelled by user");
			}
			progress.report({ message, increment });
		};

		// Update deployment if changed
		if (
			this.deployment?.url !== deployment.url ||
			this.deployment.safeHostname !== deployment.safeHostname
		) {
			this.logger.info("Deployment changed, clearing cached state", {
				old: this.deployment,
				new: deployment,
			});
			this.clearRefreshState();
			this.deployment = deployment;
			this.setupTokenListener();
		}

		const client = CoderApi.create(deployment.url, undefined, this.logger);
		const axiosInstance = client.getAxiosInstance();

		reportProgress("fetching metadata...", 10);
		const metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
		const metadata = await metadataClient.getMetadata();

		// Only register the client on login
		reportProgress("registering client...", 10);
		const registration = await this.registerClient(axiosInstance, metadata);

		reportProgress("waiting for authorization...", 30);
		const { code, verifier } = await this.startAuthorization(
			metadata,
			registration,
			cancellationToken,
		);

		reportProgress("exchanging token...", 30);
		const tokenResponse = await this.exchangeToken(
			code,
			verifier,
			axiosInstance,
			metadata,
			registration,
		);

		reportProgress("fetching user...", 20);
		const user = await client.getAuthenticatedUser();

		this.logger.info("OAuth login flow completed successfully");

		return {
			token: tokenResponse.access_token,
			user,
		};
	}

	/**
	 * Build authorization URL with all required OAuth 2.1 parameters.
	 */
	private buildAuthorizationUrl(
		metadata: OAuthServerMetadata,
		clientId: string,
		state: string,
		challenge: string,
	): string {
		if (metadata.scopes_supported) {
			const requestedScopes = DEFAULT_OAUTH_SCOPES.split(" ");
			const unsupportedScopes = requestedScopes.filter(
				(s) => !metadata.scopes_supported?.includes(s),
			);
			if (unsupportedScopes.length > 0) {
				this.logger.warn(
					`Requested scopes not in server's supported scopes: ${unsupportedScopes.join(", ")}. Server may still accept them.`,
					{ supported_scopes: metadata.scopes_supported },
				);
			}
		}

		const params = new URLSearchParams({
			client_id: clientId,
			response_type: RESPONSE_TYPE,
			redirect_uri: this.getRedirectUri(),
			scope: DEFAULT_OAUTH_SCOPES,
			state,
			code_challenge: challenge,
			code_challenge_method: PKCE_CHALLENGE_METHOD,
		});

		const url = `${metadata.authorization_endpoint}?${params.toString()}`;

		this.logger.debug("Built OAuth authorization URL:", {
			client_id: clientId,
			redirect_uri: this.getRedirectUri(),
			scope: DEFAULT_OAUTH_SCOPES,
		});

		return url;
	}

	/**
	 * Start OAuth authorization flow.
	 * Opens browser for user authentication and waits for callback.
	 * Returns authorization code and PKCE verifier on success.
	 */
	private async startAuthorization(
		metadata: OAuthServerMetadata,
		registration: ClientRegistrationResponse,
		cancellationToken: vscode.CancellationToken,
	): Promise<{ code: string; verifier: string }> {
		const state = generateState();
		const { verifier, challenge } = generatePKCE();

		const authUrl = this.buildAuthorizationUrl(
			metadata,
			registration.client_id,
			state,
			challenge,
		);

		const callbackPromise = new Promise<{ code: string; verifier: string }>(
			(resolve, reject) => {
				const timeoutMins = 5;
				const timeoutHandle = setTimeout(
					() => {
						cleanup();
						reject(
							new Error(`OAuth flow timed out after ${timeoutMins} minutes`),
						);
					},
					timeoutMins * 60 * 1000,
				);

				const listener = this.secretsManager.onDidChangeOAuthCallback(
					({ state: callbackState, code, error }) => {
						if (callbackState !== state) {
							return;
						}

						cleanup();

						if (error) {
							reject(new Error(`OAuth error: ${error}`));
						} else if (code) {
							resolve({ code, verifier });
						} else {
							reject(new Error("No authorization code received"));
						}
					},
				);

				const cancellationListener = cancellationToken.onCancellationRequested(
					() => {
						cleanup();
						reject(new Error("OAuth flow cancelled by user"));
					},
				);

				const cleanup = () => {
					clearTimeout(timeoutHandle);
					listener.dispose();
					cancellationListener.dispose();
				};

				this.pendingAuthReject = (error) => {
					cleanup();
					reject(error);
				};
			},
		);

		try {
			await vscode.env.openExternal(vscode.Uri.parse(authUrl));
		} catch (error) {
			throw error instanceof Error
				? error
				: new Error("Failed to open browser");
		}

		return callbackPromise;
	}

	/**
	 * Handle OAuth callback from browser redirect.
	 * Writes the callback result to secrets storage, triggering the waiting window to proceed.
	 */
	public async handleCallback(
		code: string | null,
		state: string | null,
		error: string | null,
	): Promise<void> {
		if (!state) {
			this.logger.warn("Received OAuth callback with no state parameter");
			return;
		}

		try {
			await this.secretsManager.setOAuthCallback({ state, code, error });
			this.logger.debug("OAuth callback processed successfully");
		} catch (err) {
			this.logger.error("Failed to process OAuth callback:", err);
		}
	}

	/**
	 * Exchange authorization code for access token.
	 */
	private async exchangeToken(
		code: string,
		verifier: string,
		axiosInstance: AxiosInstance,
		metadata: OAuthServerMetadata,
		registration: ClientRegistrationResponse,
	): Promise<TokenResponse> {
		this.logger.info("Exchanging authorization code for token");

		try {
			const params: TokenRequestParams = {
				grant_type: AUTH_GRANT_TYPE,
				code,
				redirect_uri: this.getRedirectUri(),
				client_id: registration.client_id,
				client_secret: registration.client_secret,
				code_verifier: verifier,
			};

			const tokenRequest = toUrlSearchParams(params);

			const response = await axiosInstance.post<TokenResponse>(
				metadata.token_endpoint,
				tokenRequest,
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				},
			);

			this.logger.info("Token exchange successful");

			await this.saveTokens(response.data);

			return response.data;
		} catch (error) {
			this.handleOAuthError(error);
			throw error;
		}
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 * Uses a shared promise to handle concurrent refresh attempts.
	 */
	public async refreshToken(): Promise<TokenResponse> {
		// If a refresh is already in progress, return the existing promise
		if (this.refreshPromise) {
			this.logger.debug(
				"Token refresh already in progress, waiting for result",
			);
			return this.refreshPromise;
		}

		// Read fresh tokens from secrets
		const storedTokens = await this.getStoredTokens();
		if (!storedTokens?.refresh_token) {
			throw new Error("No refresh token available");
		}

		const refreshToken = storedTokens.refresh_token;
		const accessToken = storedTokens.access_token;

		this.lastRefreshAttempt = Date.now();

		// Create and store the refresh promise
		this.refreshPromise = (async () => {
			try {
				const { axiosInstance, metadata, registration } =
					await this.prepareOAuthOperation(accessToken);

				this.logger.debug("Refreshing access token");

				const params: RefreshTokenRequestParams = {
					grant_type: REFRESH_GRANT_TYPE,
					refresh_token: refreshToken,
					client_id: registration.client_id,
					client_secret: registration.client_secret,
				};

				const tokenRequest = toUrlSearchParams(params);

				const response = await axiosInstance.post<TokenResponse>(
					metadata.token_endpoint,
					tokenRequest,
					{
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
						},
					},
				);

				this.logger.debug("Token refresh successful");

				await this.saveTokens(response.data);

				return response.data;
			} catch (error) {
				this.handleOAuthError(error);
				throw error;
			} finally {
				this.refreshPromise = null;
			}
		})();

		return this.refreshPromise;
	}

	/**
	 * Save token response to storage.
	 * Writes to secrets manager only - no in-memory caching.
	 */
	private async saveTokens(tokenResponse: TokenResponse): Promise<void> {
		const deployment = this.requireDeployment();
		const expiryTimestamp = tokenResponse.expires_in
			? Date.now() + tokenResponse.expires_in * 1000
			: Date.now() + ACCESS_TOKEN_DEFAULT_EXPIRY_MS;

		const oauth: OAuthTokenData = {
			token_type: tokenResponse.token_type,
			refresh_token: tokenResponse.refresh_token,
			scope: tokenResponse.scope,
			expiry_timestamp: expiryTimestamp,
		};

		await this.secretsManager.setSessionAuth(deployment.safeHostname, {
			url: deployment.url,
			token: tokenResponse.access_token,
			oauth,
		});

		this.logger.info("Tokens saved", {
			expires_at: new Date(expiryTimestamp).toISOString(),
			deployment: deployment.url,
		});
	}

	/**
	 * Refreshes the token if it is approaching expiry.
	 */
	public async refreshIfAlmostExpired(): Promise<void> {
		if (await this.shouldRefreshToken()) {
			this.logger.debug("Token approaching expiry, triggering refresh");
			await this.refreshToken();
		}
	}

	/**
	 * Check if token should be refreshed.
	 * Returns true if:
	 * 1. Stored tokens exist with a refresh token
	 * 2. Token expires in less than TOKEN_REFRESH_THRESHOLD_MS
	 * 3. Last refresh attempt was more than REFRESH_THROTTLE_MS ago
	 * 4. No refresh is currently in progress
	 */
	private async shouldRefreshToken(): Promise<boolean> {
		const storedTokens = await this.getStoredTokens();
		if (!storedTokens?.refresh_token || this.refreshPromise !== null) {
			return false;
		}

		const now = Date.now();
		if (now - this.lastRefreshAttempt < REFRESH_THROTTLE_MS) {
			return false;
		}

		const timeUntilExpiry = storedTokens.expiry_timestamp - now;
		return timeUntilExpiry < TOKEN_REFRESH_THRESHOLD_MS;
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

		const revocationEndpoint =
			metadata.revocation_endpoint || `${metadata.issuer}/oauth2/revoke`;

		this.logger.info("Revoking refresh token");

		const params: TokenRevocationRequest = {
			token: tokenToRevoke,
			client_id: registration.client_id,
			client_secret: registration.client_secret,
			token_type_hint: tokenTypeHint,
		};

		const revocationRequest = toUrlSearchParams(params);

		try {
			await axiosInstance.post(revocationEndpoint, revocationRequest, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			});

			this.logger.info("Token revocation successful");
		} catch (error) {
			this.logger.error("Token revocation failed:", error);
			throw error;
		}
	}

	/**
	 * Returns true if OAuth tokens exist for the current deployment.
	 * Always reads fresh from secrets to ensure cross-window synchronization.
	 */
	public async isLoggedInWithOAuth(): Promise<boolean> {
		const storedTokens = await this.getStoredTokens();
		return storedTokens !== undefined;
	}

	/**
	 * Clear OAuth state when switching to non-OAuth authentication.
	 * Removes OAuth data from session auth while preserving the session token.
	 * Preserves client registration for potential future OAuth use.
	 */
	public async clearOAuthState(): Promise<void> {
		this.clearRefreshState();
		if (this.deployment) {
			const auth = await this.secretsManager.getSessionAuth(
				this.deployment.safeHostname,
			);
			if (auth?.oauth) {
				await this.clearOAuthFromSessionAuth(auth);
			}
		}
	}

	/**
	 * Handle OAuth errors that may require re-authentication.
	 * Parses the error and triggers re-authentication modal if needed.
	 */
	private handleOAuthError(error: unknown): void {
		const oauthError = parseOAuthError(error);
		if (oauthError && requiresReAuthentication(oauthError)) {
			this.logger.error(
				`OAuth operation failed with error: ${oauthError.errorCode}`,
			);
			// Fire and forget - don't block on showing the modal
			this.showReAuthenticationModal(oauthError).catch((err) => {
				this.logger.error("Failed to show re-auth modal:", err);
			});
		}
	}

	/**
	 * Show a modal dialog to the user when OAuth re-authentication is required.
	 * This is called when the refresh token is invalid or the client credentials are invalid.
	 * Clears tokens directly and lets listeners handle updates.
	 */
	public async showReAuthenticationModal(error: OAuthError): Promise<void> {
		const deployment = this.requireDeployment();
		const errorMessage =
			error.description ||
			"Your session is no longer valid. This could be due to token expiration or revocation.";

		this.clearRefreshState();
		// Clear client registration and tokens to force full re-authentication
		await this.secretsManager.clearOAuthClientRegistration(
			deployment.safeHostname,
		);
		await this.secretsManager.setSessionAuth(deployment.safeHostname, {
			url: deployment.url,
			token: "",
		});

		await this.loginCoordinator.ensureLoggedInWithDialog({
			safeHostname: deployment.safeHostname,
			url: deployment.url,
			detailPrefix: errorMessage,
			oauthSessionManager: this,
		});
	}

	/**
	 * Clears all in-memory state.
	 */
	public dispose(): void {
		if (this.pendingAuthReject) {
			this.pendingAuthReject(new Error("OAuth session manager disposed"));
		}
		this.pendingAuthReject = undefined;
		this.clearDeployment();

		this.logger.debug("OAuth session manager disposed");
	}
}
