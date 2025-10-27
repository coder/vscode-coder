import axios, { type AxiosInstance } from "axios";
import * as vscode from "vscode";

import { OAuthClientRegistry } from "./clientRegistry";
import { OAuthMetadataClient } from "./metadataClient";
import { OAuthTokenRefreshScheduler } from "./tokenRefreshScheduler";
import {
	CALLBACK_PATH,
	generatePKCE,
	generateState,
	toUrlSearchParams,
} from "./utils";

import type { SecretsManager, StoredOAuthTokens } from "../core/secretsManager";
import type { Logger } from "../logging/logger";

import type {
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
	private readonly extensionId: string;
	private readonly refreshScheduler: OAuthTokenRefreshScheduler;

	private metadataClient: OAuthMetadataClient;
	private clientRegistry: OAuthClientRegistry;

	private metadata: OAuthServerMetadata | undefined;
	private storedTokens: StoredOAuthTokens | undefined;

	// Pending authorization flow state
	private pendingAuthResolve:
		| ((value: { code: string; verifier: string }) => void)
		| undefined;
	private pendingAuthReject: ((reason: Error) => void) | undefined;
	private expectedState: string | undefined;
	private pendingVerifier: string | undefined;

	/**
	 * Create and initialize a new OAuth session manager.
	 */
	static async create(
		deploymentUrl: string,
		secretsManager: SecretsManager,
		logger: Logger,
		context: vscode.ExtensionContext,
	): Promise<OAuthSessionManager> {
		const manager = new OAuthSessionManager(
			deploymentUrl,
			secretsManager,
			logger,
			context,
		);
		await manager.initialize();
		return manager;
	}

	private constructor(
		private deploymentUrl: string,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		context: vscode.ExtensionContext,
	) {
		this.extensionId = context.extension.id;

		const axiosInstance = this.createAxiosInstance();

		this.metadataClient = new OAuthMetadataClient(axiosInstance, logger);
		this.clientRegistry = new OAuthClientRegistry(
			axiosInstance,
			secretsManager,
			logger,
		);
		this.refreshScheduler = new OAuthTokenRefreshScheduler(async () => {
			await this.refreshToken();
		}, logger);
	}

	/**
	 * Create axios instance for the current deployment URL.
	 */
	private createAxiosInstance(): AxiosInstance {
		return axios.create({
			baseURL: this.deploymentUrl,
		});
	}

	/**
	 * Initialize the session manager by loading persisted state.
	 */
	private async initialize(): Promise<void> {
		await this.clientRegistry.load();
		await this.loadTokens();
	}

	/**
	 * Load stored tokens and start refresh timer if applicable.
	 * Validates that tokens belong to the current deployment URL.
	 */
	private async loadTokens(): Promise<void> {
		const tokens = await this.secretsManager.getOAuthTokens();
		if (!tokens) {
			return;
		}

		// Validate URL match (only if we have a deploymentUrl set)
		if (
			this.deploymentUrl &&
			tokens.deployment_url &&
			tokens.deployment_url !== this.deploymentUrl
		) {
			this.logger.warn("Stored tokens for different deployment, clearing", {
				stored: tokens.deployment_url,
				current: this.deploymentUrl,
			});
			await this.clearStaleData();
			return;
		}

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
		this.logger.info("Loaded stored OAuth tokens", {
			expires_at: new Date(tokens.expiry_timestamp).toISOString(),
			scope: tokens.scope,
			deployment: tokens.deployment_url,
		});

		if (tokens.refresh_token) {
			this.refreshScheduler.schedule(tokens);
		}
	}

	/**
	 * Clear stale data when tokens don't match current deployment.
	 */
	private async clearStaleData(): Promise<void> {
		this.refreshScheduler.stop();
		await this.secretsManager.setOAuthTokens(undefined);
		await this.clientRegistry.clear();
	}

	/**
	 * Clear all state when switching to a new deployment URL.
	 */
	private async clearForNewUrl(): Promise<void> {
		this.refreshScheduler.stop();
		this.metadata = undefined;
		this.storedTokens = undefined;
		await this.secretsManager.setOAuthTokens(undefined);
		await this.clientRegistry.clear();
	}

	/**
	 * Check if granted scopes cover all required scopes.
	 * Supports wildcard scopes like "workspace:*".
	 */
	private hasRequiredScopes(grantedScope: string | undefined): boolean {
		if (!grantedScope) {
			return false;
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
	 * Get OAuth server metadata, fetching if not already cached.
	 */
	private async getMetadata(): Promise<OAuthServerMetadata> {
		this.metadata ??= await this.metadataClient.getMetadata();
		return this.metadata;
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
	 *
	 * @param url Coder deployment URL to authenticate against
	 */
	async startAuthorization(
		url: string,
	): Promise<{ code: string; verifier: string }> {
		if (this.deploymentUrl !== url) {
			this.logger.info("Deployment URL changed, clearing cached state", {
				old: this.deploymentUrl,
				new: url,
			});
			await this.clearForNewUrl();
			this.deploymentUrl = url;

			// Recreate components with new axios instance for new URL
			const axiosInstance = this.createAxiosInstance();
			this.metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
			this.clientRegistry = new OAuthClientRegistry(
				axiosInstance,
				this.secretsManager,
				this.logger,
			);
		}

		// Clear cached metadata (may be stale)
		this.metadata = undefined;

		const metadata = await this.getMetadata();
		const registration = await this.clientRegistry.register(
			metadata,
			this.getRedirectUri(),
		);
		const state = generateState();
		const { verifier, challenge } = generatePKCE();

		const authUrl = this.buildAuthorizationUrl(
			metadata,
			registration.client_id,
			state,
			challenge,
		);

		return new Promise<{ code: string; verifier: string }>(
			(resolve, reject) => {
				const timeoutMins = 5;
				const timeout = setTimeout(
					() => {
						this.clearPendingAuth();
						reject(
							new Error(`OAuth flow timed out after ${timeoutMins} minutes`),
						);
					},
					timeoutMins * 60 * 1000,
				);

				const clearPromise = () => {
					clearTimeout(timeout);
					this.clearPendingAuth();
				};

				this.pendingAuthResolve = (result) => {
					clearPromise();
					resolve(result);
				};

				this.pendingAuthReject = (error) => {
					clearPromise();
					reject(error);
				};

				this.expectedState = state;
				this.pendingVerifier = verifier;

				vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
					() => {},
					(error) => {
						if (error instanceof Error) {
							this.pendingAuthReject?.(error);
						} else {
							this.pendingAuthReject?.(new Error("Failed to open browser"));
						}
					},
				);
			},
		);
	}

	/**
	 * Clear pending authorization flow state.
	 */
	private clearPendingAuth(): void {
		this.pendingAuthResolve = undefined;
		this.pendingAuthReject = undefined;
		this.expectedState = undefined;
		this.pendingVerifier = undefined;
	}

	/**
	 * Handle OAuth callback from browser redirect.
	 * Validates state and resolves pending authorization promise.
	 */
	handleCallback(
		code: string | null,
		state: string | null,
		error: string | null,
	): void {
		if (!this.pendingAuthResolve || !this.pendingAuthReject) {
			this.logger.warn("Received OAuth callback but no pending auth flow");
			return;
		}

		if (error) {
			this.pendingAuthReject(new Error(`OAuth error: ${error}`));
			return;
		}

		if (!code) {
			this.pendingAuthReject(new Error("No authorization code received"));
			return;
		}

		if (!state) {
			this.pendingAuthReject(new Error("No state received"));
			return;
		}

		if (state !== this.expectedState) {
			this.pendingAuthReject(
				new Error("State mismatch - possible CSRF attack"),
			);
			return;
		}

		const verifier = this.pendingVerifier;
		if (!verifier) {
			this.pendingAuthReject(new Error("No PKCE verifier found"));
			return;
		}

		this.pendingAuthResolve({ code, verifier });
	}

	/**
	 * Exchange authorization code for access token.
	 */
	async exchangeToken(code: string, verifier: string): Promise<TokenResponse> {
		const metadata = await this.getMetadata();
		const registration = this.clientRegistry.get();

		if (!registration) {
			throw new Error("No client registration found");
		}

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

		const axiosInstance = this.createAxiosInstance();
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
	 */
	private async refreshToken(): Promise<TokenResponse> {
		if (!this.storedTokens?.refresh_token) {
			throw new Error("No refresh token available");
		}

		const registration = this.clientRegistry.get();
		if (!registration) {
			throw new Error("No client registration found");
		}

		const metadata = await this.getMetadata();

		this.logger.debug("Refreshing access token");

		const params: RefreshTokenRequestParams = {
			grant_type: REFRESH_GRANT_TYPE,
			refresh_token: this.storedTokens.refresh_token,
			client_id: registration.client_id,
			client_secret: registration.client_secret,
		};

		const tokenRequest = toUrlSearchParams(params);

		const axiosInstance = this.createAxiosInstance();
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
	}

	/**
	 * Save token response to storage and schedule automatic refresh.
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
		// TODO Add a setting to check if we have OAuth or token setup so we can start the background refresh
		await this.secretsManager.setSessionToken(tokenResponse.access_token);

		this.logger.info("Tokens saved", {
			expires_at: new Date(expiryTimestamp).toISOString(),
			deployment: this.deploymentUrl,
		});

		// Schedule automatic refresh
		this.refreshScheduler.schedule(tokens);
	}

	/**
	 * Revoke a token using the OAuth server's revocation endpoint.
	 */
	private async revokeToken(token: string): Promise<void> {
		const registration = this.clientRegistry.get();
		if (!registration) {
			throw new Error("No client registration found");
		}

		const metadata = await this.getMetadata();

		if (!metadata.revocation_endpoint) {
			this.logger.warn(
				"Server does not support token revocation (no revocation_endpoint)",
			);
			return;
		}

		this.logger.info("Revoking refresh token");

		const params: TokenRevocationRequest = {
			token,
			client_id: registration.client_id,
			client_secret: registration.client_secret,
			token_type_hint: "refresh_token",
		};

		const revocationRequest = toUrlSearchParams(params);

		try {
			const axiosInstance = this.createAxiosInstance();
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
	 * Logout by revoking tokens and clearing all OAuth data.
	 */
	async logout(): Promise<void> {
		this.refreshScheduler.stop();

		// Revoke refresh token (which also invalidates access token per RFC 7009)
		if (this.storedTokens?.refresh_token) {
			try {
				await this.revokeToken(this.storedTokens.refresh_token);
			} catch (error) {
				this.logger.warn("Token revocation failed during logout:", error);
			}
		}

		await this.secretsManager.setOAuthTokens(undefined);
		this.storedTokens = undefined;
		await this.clientRegistry.clear();

		this.logger.info("OAuth logout complete");
	}

	/**
	 * Get the client ID if registered.
	 */
	getClientId(): string | undefined {
		return this.clientRegistry.get()?.client_id;
	}

	/**
	 * Clears all in-memory state and rejects any pending operations.
	 */
	dispose(): void {
		this.refreshScheduler.stop();

		if (this.pendingAuthReject) {
			this.pendingAuthReject(new Error("OAuth session manager disposed"));
		}
		this.clearPendingAuth();
		this.storedTokens = undefined;
		this.metadata = undefined;

		this.logger.debug("OAuth session manager disposed");
	}
}
