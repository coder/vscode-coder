import { type AxiosInstance } from "axios";
import * as vscode from "vscode";

import { type ServiceContainer } from "src/core/container";

import { CoderApi } from "../api/coderApi";

import { OAuthMetadataClient } from "./metadataClient";
import {
	CALLBACK_PATH,
	generatePKCE,
	generateState,
	toUrlSearchParams,
} from "./utils";

import type { SecretsManager, StoredOAuthTokens } from "../core/secretsManager";
import type { Logger } from "../logging/logger";

import type { OAuthError } from "./errors";
import type {
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	OAuthServerMetadata,
	RefreshTokenRequestParams,
	TokenRequestParams,
	TokenResponse,
	TokenRevocationRequest,
} from "./types";

const AUTH_GRANT_TYPE = "authorization_code" as const;
const REFRESH_GRANT_TYPE = "refresh_token" as const;
const RESPONSE_TYPE = "code" as const;
const PKCE_CHALLENGE_METHOD = "S256" as const;

/**
 * Token refresh threshold: refresh when token expires in less than this time
 */
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Minimum time between refresh attempts to prevent thrashing
 */
const REFRESH_THROTTLE_MS = 30 * 1000;

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
 * Manages OAuth session lifecycle for a Coder deployment.
 * Coordinates authorization flow, token management, and automatic refresh.
 */
export class OAuthSessionManager implements vscode.Disposable {
	private storedTokens: StoredOAuthTokens | undefined;
	private refreshInProgress = false;
	private lastRefreshAttempt = 0;

	private pendingAuthReject: ((reason: Error) => void) | undefined;

	/**
	 * Create and initialize a new OAuth session manager.
	 */
	static async create(
		deploymentUrl: string,
		container: ServiceContainer,
		context: vscode.ExtensionContext,
	): Promise<OAuthSessionManager> {
		const manager = new OAuthSessionManager(
			deploymentUrl,
			container.getSecretsManager(),
			container.getLogger(),
			container.getVsCodeProposed(),
			context.extension.id,
		);
		await manager.loadTokens();
		return manager;
	}

	private constructor(
		private deploymentUrl: string,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		private readonly vscodeProposed: typeof vscode,
		private readonly extensionId: string,
	) {}

	/**
	 * Load stored tokens from storage.
	 * Validates that tokens belong to the current deployment URL.
	 */
	private async loadTokens(): Promise<void> {
		const tokens = await this.secretsManager.getOAuthTokens();
		if (!tokens) {
			return;
		}

		if (this.deploymentUrl && tokens.deployment_url !== this.deploymentUrl) {
			this.logger.warn("Stored tokens for different deployment, clearing", {
				stored: tokens.deployment_url,
				current: this.deploymentUrl,
			});
			await this.clearTokenState();
			return;
		}
		this.deploymentUrl = tokens.deployment_url;

		if (!this.hasRequiredScopes(tokens.scope)) {
			this.logger.warn(
				"Stored token missing required scopes, clearing tokens",
				{
					stored_scope: tokens.scope,
					required_scopes: DEFAULT_OAUTH_SCOPES,
				},
			);
			await this.secretsManager.setOAuthTokens(undefined);
			return;
		}

		this.storedTokens = tokens;
		this.logger.info(`Loaded stored OAuth tokens for ${tokens.deployment_url}`);
	}

	/**
	 * Clear stale data when tokens don't match current deployment.
	 */
	private async clearTokenState(): Promise<void> {
		this.storedTokens = undefined;
		this.refreshInProgress = false;
		this.lastRefreshAttempt = 0;
		await this.secretsManager.setOAuthTokens(undefined);
		await this.secretsManager.setOAuthClientRegistration(undefined);
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
	 * Prepare common OAuth operation setup: CoderApi, metadata, and registration.
	 * Used by refresh and revoke operations to reduce duplication.
	 */
	private async prepareOAuthOperation(
		deploymentUrl: string,
		token?: string,
	): Promise<{
		axiosInstance: AxiosInstance;
		metadata: OAuthServerMetadata;
		registration: ClientRegistrationResponse;
	}> {
		const client = CoderApi.create(deploymentUrl, token, this.logger);
		const axiosInstance = client.getAxiosInstance();

		const metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
		const metadata = await metadataClient.getMetadata();

		const registration = await this.secretsManager.getOAuthClientRegistration();
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
		const redirectUri = this.getRedirectUri();

		const existing = await this.secretsManager.getOAuthClientRegistration();
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

		await this.secretsManager.setOAuthClientRegistration(response.data);
		this.logger.info(
			"Saved OAuth client registration:",
			response.data.client_id,
		);

		return response.data;
	}

	/**
	 * Simplified OAuth login flow that handles the entire process.
	 * Fetches metadata, registers client, starts authorization, and exchanges tokens.
	 *
	 * @param client CoderApi instance for the deployment to authenticate against
	 * @returns TokenResponse containing access token and optional refresh token
	 */
	async login(
		client: CoderApi,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
	): Promise<TokenResponse> {
		const baseUrl = client.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("CoderApi instance has no base URL set");
		}
		if (this.deploymentUrl && this.deploymentUrl !== baseUrl) {
			this.logger.info("Deployment URL changed, clearing cached state", {
				old: this.deploymentUrl,
				new: baseUrl,
			});
			await this.clearTokenState();
			this.deploymentUrl = baseUrl;
		}

		const axiosInstance = client.getAxiosInstance();
		const metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
		const metadata = await metadataClient.getMetadata();

		// Only register the client on login
		progress.report({ message: "registering client...", increment: 10 });
		const registration = await this.registerClient(axiosInstance, metadata);

		progress.report({ message: "waiting for authorization...", increment: 30 });
		const { code, verifier } = await this.startAuthorization(
			metadata,
			registration,
		);

		progress.report({ message: "exchanging token...", increment: 30 });
		const tokenResponse = await this.exchangeToken(
			code,
			verifier,
			axiosInstance,
			metadata,
			registration,
		);

		progress.report({ increment: 30 });
		this.logger.info("OAuth login flow completed successfully");

		return tokenResponse;
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

				const cleanup = () => {
					clearTimeout(timeoutHandle);
					listener.dispose();
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
	async handleCallback(
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
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 * Uses a mutex to prevent concurrent refresh attempts.
	 */
	async refreshToken(): Promise<TokenResponse> {
		if (this.refreshInProgress) {
			throw new Error("Token refresh already in progress");
		}

		if (!this.storedTokens?.refresh_token) {
			throw new Error("No refresh token available");
		}

		this.refreshInProgress = true;
		this.lastRefreshAttempt = Date.now();

		try {
			const { axiosInstance, metadata, registration } =
				await this.prepareOAuthOperation(
					this.deploymentUrl,
					this.storedTokens.access_token,
				);

			this.logger.debug("Refreshing access token");

			const params: RefreshTokenRequestParams = {
				grant_type: REFRESH_GRANT_TYPE,
				refresh_token: this.storedTokens.refresh_token,
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
		} finally {
			this.refreshInProgress = false;
		}
	}

	/**
	 * Save token response to storage.
	 * Also triggers event via secretsManager to update global client.
	 */
	private async saveTokens(tokenResponse: TokenResponse): Promise<void> {
		const expiryTimestamp = tokenResponse.expires_in
			? Date.now() + tokenResponse.expires_in * 1000
			: Date.now() + 3600 * 1000; // TODO Default to 1 hour

		const tokens: StoredOAuthTokens = {
			...tokenResponse,
			deployment_url: this.deploymentUrl,
			expiry_timestamp: expiryTimestamp,
		};

		this.storedTokens = tokens;
		await this.secretsManager.setOAuthTokens(tokens);

		// Trigger event to update global client (works for login & background refresh)
		await this.secretsManager.setSessionToken(tokenResponse.access_token);

		this.logger.info("Tokens saved", {
			expires_at: new Date(expiryTimestamp).toISOString(),
			deployment: this.deploymentUrl,
		});
	}

	/**
	 * Check if token should be refreshed.
	 * Returns true if:
	 * 1. Token expires in less than TOKEN_REFRESH_THRESHOLD_MS
	 * 2. Last refresh attempt was more than REFRESH_THROTTLE_MS ago
	 * 3. No refresh is currently in progress
	 */
	shouldRefreshToken(): boolean {
		if (
			!this.isLoggedInWithOAuth() ||
			!this.storedTokens?.refresh_token ||
			this.refreshInProgress
		) {
			return false;
		}

		const now = Date.now();
		if (now - this.lastRefreshAttempt < REFRESH_THROTTLE_MS) {
			return false;
		}

		const timeUntilExpiry = this.storedTokens.expiry_timestamp - now;
		return timeUntilExpiry < TOKEN_REFRESH_THRESHOLD_MS;
	}

	/**
	 * Revoke a token using the OAuth server's revocation endpoint.
	 */
	private async revokeToken(
		token: string,
		tokenTypeHint: "access_token" | "refresh_token" = "refresh_token",
	): Promise<void> {
		const { axiosInstance, metadata, registration } =
			await this.prepareOAuthOperation(
				this.deploymentUrl,
				this.storedTokens?.access_token,
			);

		const revocationEndpoint =
			metadata.revocation_endpoint || `${metadata.issuer}/oauth2/revoke`;

		this.logger.info("Revoking refresh token");

		const params: TokenRevocationRequest = {
			token,
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
	 * Logout by revoking tokens and clearing all OAuth data.
	 */
	async logout(): Promise<void> {
		if (!this.isLoggedInWithOAuth()) {
			return;
		}

		// Revoke refresh token (which also invalidates access token per RFC 7009)
		if (this.storedTokens?.refresh_token) {
			try {
				await this.revokeToken(this.storedTokens.refresh_token);
			} catch (error) {
				this.logger.warn("Token revocation failed during logout:", error);
			}
		}

		await this.clearTokenState();

		this.logger.info("OAuth logout complete");
	}

	/**
	 * Returns true if (valid or invalid) OAuth tokens exist for the current deployment.
	 */
	isLoggedInWithOAuth(): boolean {
		return this.storedTokens !== undefined;
	}

	/**
	 * Show a modal dialog to the user when OAuth re-authentication is required.
	 * This is called when the refresh token is invalid or the client credentials are invalid.
	 */
	async showReAuthenticationModal(error: OAuthError): Promise<void> {
		const errorMessage =
			error.description ||
			"Your session is no longer valid. This could be due to token expiration or revocation.";

		// Log out first to clear invalid tokens
		await vscode.commands.executeCommand("coder.logout");

		const action = await this.vscodeProposed.window.showErrorMessage(
			`Authentication Error`,
			{ modal: true, useCustom: true, detail: errorMessage },
			"Log in again",
		);

		if (action === "Log in again") {
			await vscode.commands.executeCommand("coder.login");
		}
	}

	/**
	 * Clears all in-memory state.
	 */
	dispose(): void {
		if (this.pendingAuthReject) {
			this.pendingAuthReject(new Error("OAuth session manager disposed"));
		}
		this.pendingAuthReject = undefined;
		this.storedTokens = undefined;
		this.refreshInProgress = false;
		this.lastRefreshAttempt = 0;

		this.logger.debug("OAuth session manager disposed");
	}
}
