import * as vscode from "vscode";

import { type CoderApi } from "../api/coderApi";
import {
	type StoredOAuthTokens,
	type SecretsManager,
} from "../core/secretsManager";

import { CALLBACK_PATH, generatePKCE, generateState } from "./utils";

import type { Logger } from "../logging/logger";

import type {
	AuthorizationRequestParams,
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
const OAUTH_METHOD = "client_secret_post" as const;
const PKCE_CHALLENGE_METHOD = "S256" as const;
const CLIENT_NAME = "VS Code Coder Extension";

const REQUIRED_GRANT_TYPES = [AUTH_GRANT_TYPE, REFRESH_GRANT_TYPE] as const;

// Token refresh timing constants (5 minutes before expiry)
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Minimal scopes required by the VS Code extension:
 * - workspace:read: List and read workspace details
 * - workspace:update: Update workspace version
 * - workspace:start: Start stopped workspaces
 * - workspace:ssh: SSH configuration for remote connections
 * - workspace:application_connect: Connect to workspace agents/apps
 * - template:read: Read templates and versions
 * - user:read_personal: Read authenticated user info
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

export class CoderOAuthHelper {
	private clientRegistration: ClientRegistrationResponse | undefined;
	private cachedMetadata: OAuthServerMetadata | undefined;
	private pendingAuthResolve:
		| ((value: { code: string; verifier: string }) => void)
		| undefined;
	private pendingAuthReject: ((reason: Error) => void) | undefined;
	private expectedState: string | undefined;
	private pendingVerifier: string | undefined;
	private storedTokens: StoredOAuthTokens | undefined;
	private refreshTimer: NodeJS.Timeout | undefined;

	private readonly extensionId: string;

	static async create(
		client: CoderApi,
		secretsManager: SecretsManager,
		logger: Logger,
		context: vscode.ExtensionContext,
	): Promise<CoderOAuthHelper> {
		const helper = new CoderOAuthHelper(
			client,
			secretsManager,
			logger,
			context,
		);
		await helper.loadClientRegistration();
		await helper.loadTokens();
		return helper;
	}
	private constructor(
		private readonly client: CoderApi,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		context: vscode.ExtensionContext,
	) {
		this.extensionId = context.extension.id;
	}

	private async getMetadata(): Promise<OAuthServerMetadata> {
		if (this.cachedMetadata) {
			return this.cachedMetadata;
		}

		this.logger.info("Discovering OAuth endpoints...");

		const response = await this.client
			.getAxiosInstance()
			.get<OAuthServerMetadata>("/.well-known/oauth-authorization-server");

		const metadata = response.data;

		if (
			!metadata.authorization_endpoint ||
			!metadata.token_endpoint ||
			!metadata.issuer
		) {
			throw new Error(
				"OAuth server metadata missing required endpoints: " +
					JSON.stringify(metadata),
			);
		}

		if (
			!includesAllTypes(metadata.grant_types_supported, REQUIRED_GRANT_TYPES)
		) {
			throw new Error(
				`Server does not support required grant types: ${REQUIRED_GRANT_TYPES.join(", ")}. Supported: ${metadata.grant_types_supported?.join(", ") || "none"}`,
			);
		}

		if (!includesAllTypes(metadata.response_types_supported, [RESPONSE_TYPE])) {
			throw new Error(
				`Server does not support required response type: ${RESPONSE_TYPE}. Supported: ${metadata.response_types_supported?.join(", ") || "none"}`,
			);
		}

		if (
			!includesAllTypes(metadata.token_endpoint_auth_methods_supported, [
				OAUTH_METHOD,
			])
		) {
			throw new Error(
				`Server does not support required auth method: ${OAUTH_METHOD}. Supported: ${metadata.token_endpoint_auth_methods_supported?.join(", ") || "none"}`,
			);
		}

		if (
			!includesAllTypes(metadata.code_challenge_methods_supported, [
				PKCE_CHALLENGE_METHOD,
			])
		) {
			throw new Error(
				`Server does not support required PKCE method: ${PKCE_CHALLENGE_METHOD}. Supported: ${metadata.code_challenge_methods_supported?.join(", ") || "none"}`,
			);
		}

		this.cachedMetadata = metadata;
		this.logger.debug("OAuth endpoints discovered:", {
			authorization: metadata.authorization_endpoint,
			token: metadata.token_endpoint,
			registration: metadata.registration_endpoint,
			revocation: metadata.revocation_endpoint,
		});

		return metadata;
	}

	private getRedirectUri(): string {
		return `${vscode.env.uriScheme}://${this.extensionId}${CALLBACK_PATH}`;
	}

	private async loadClientRegistration(): Promise<void> {
		const registration = await this.secretsManager.getOAuthClientRegistration();
		if (registration) {
			this.clientRegistration = registration;
			this.logger.info("Loaded existing OAuth client:", registration.client_id);
		}
	}

	private async loadTokens(): Promise<void> {
		const tokens = await this.secretsManager.getOAuthTokens();
		if (tokens) {
			if (!this.hasRequiredScopes(tokens.scope)) {
				this.logger.warn(
					"Stored token missing required scopes, clearing tokens",
					{
						stored_scope: tokens.scope,
						required_scopes: DEFAULT_OAUTH_SCOPES,
					},
				);
				await this.secretsManager.clearOAuthTokens();
				return;
			}

			this.storedTokens = tokens;
			this.logger.info("Loaded stored OAuth tokens", {
				expires_at: new Date(tokens.expiry_timestamp).toISOString(),
				scope: tokens.scope,
			});

			if (tokens.refresh_token) {
				this.startRefreshTimer();
			}
		}
	}

	/**
	 * Check if granted scopes cover all required scopes.
	 * Supports wildcard scopes like "workspace:*" which grant all "workspace:" prefixed scopes.
	 */
	private hasRequiredScopes(grantedScope: string | undefined): boolean {
		if (!grantedScope) {
			return false;
		}

		const grantedScopes = new Set(grantedScope.split(" "));
		const requiredScopes = DEFAULT_OAUTH_SCOPES.split(" ");

		for (const required of requiredScopes) {
			// Check exact match
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

	private async saveClientRegistration(
		registration: ClientRegistrationResponse,
	): Promise<void> {
		await this.secretsManager.setOAuthClientRegistration(registration);
		this.clientRegistration = registration;
		this.logger.info(
			"Saved OAuth client registration:",
			registration.client_id,
		);
	}

	async clearClientRegistration(): Promise<void> {
		await this.secretsManager.setOAuthClientRegistration(undefined);
		this.clientRegistration = undefined;
		this.logger.info("Cleared OAuth client registration");
	}

	async registerClient(): Promise<string> {
		const redirectUri = this.getRedirectUri();

		if (this.clientRegistration?.client_id) {
			const clientId = this.clientRegistration.client_id;
			if (this.clientRegistration.redirect_uris.includes(redirectUri)) {
				this.logger.info("Using existing client registration:", clientId);
				return clientId;
			}
			this.logger.info("Redirect URI changed, re-registering client");
		}

		const metadata = await this.getMetadata();

		if (!metadata.registration_endpoint) {
			throw new Error(
				"Server does not support dynamic client registration (no registration_endpoint in metadata)",
			);
		}

		// "web" type since VS Code Secrets API allows secure client_secret storage (confidential client).
		const registrationRequest: ClientRegistrationRequest = {
			redirect_uris: [redirectUri],
			application_type: "web",
			grant_types: [AUTH_GRANT_TYPE],
			response_types: [RESPONSE_TYPE],
			client_name: CLIENT_NAME,
			token_endpoint_auth_method: OAUTH_METHOD,
		};

		const response = await this.client
			.getAxiosInstance()
			.post<ClientRegistrationResponse>(
				metadata.registration_endpoint,
				registrationRequest,
			);

		await this.saveClientRegistration(response.data);

		return response.data.client_id;
	}

	private buildAuthorizationUrl(
		metadata: OAuthServerMetadata,
		clientId: string,
		state: string,
		challenge: string,
		scope: string,
	): string {
		if (metadata.scopes_supported) {
			const requestedScopes = scope.split(" ");
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

		const params: AuthorizationRequestParams = {
			client_id: clientId,
			response_type: RESPONSE_TYPE,
			redirect_uri: this.getRedirectUri(),
			scope,
			state,
			code_challenge: challenge,
			code_challenge_method: PKCE_CHALLENGE_METHOD,
		};

		const url = `${metadata.authorization_endpoint}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`;

		this.logger.debug("Building OAuth authorization URL:", {
			client_id: clientId,
			redirect_uri: this.getRedirectUri(),
			scope,
		});

		return url;
	}

	async startAuthorization(): Promise<{ code: string; verifier: string }> {
		const metadata = await this.getMetadata();
		const clientId = await this.registerClient();
		const state = generateState();
		const { verifier, challenge } = generatePKCE();

		const authUrl = this.buildAuthorizationUrl(
			metadata,
			clientId,
			state,
			challenge,
			DEFAULT_OAUTH_SCOPES,
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

	private clearPendingAuth(): void {
		this.pendingAuthResolve = undefined;
		this.pendingAuthReject = undefined;
		this.expectedState = undefined;
		this.pendingVerifier = undefined;
	}

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

	async exchangeToken(code: string, verifier: string): Promise<TokenResponse> {
		const metadata = await this.getMetadata();

		if (!this.clientRegistration) {
			throw new Error("No client registration found");
		}

		this.logger.info("Exchanging authorization code for token");

		const params: TokenRequestParams = {
			grant_type: AUTH_GRANT_TYPE,
			code,
			redirect_uri: this.getRedirectUri(),
			client_id: this.clientRegistration.client_id,
			code_verifier: verifier,
		};

		if (this.clientRegistration.client_secret) {
			params.client_secret = this.clientRegistration.client_secret;
		}

		const tokenRequest = toUrlSearchParams(params);

		const response = await this.client
			.getAxiosInstance()
			.post<TokenResponse>(metadata.token_endpoint, tokenRequest, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			});

		this.logger.info("Token exchange successful");

		await this.saveTokens(response.data);

		return response.data;
	}

	getClientId(): string | undefined {
		return this.clientRegistration?.client_id;
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 */
	private async refreshToken(): Promise<TokenResponse> {
		if (!this.storedTokens?.refresh_token) {
			throw new Error("No refresh token available");
		}

		if (!this.clientRegistration) {
			throw new Error("No client registration found");
		}

		const metadata = await this.getMetadata();

		this.logger.debug("Refreshing access token");

		const params: RefreshTokenRequestParams = {
			grant_type: REFRESH_GRANT_TYPE,
			refresh_token: this.storedTokens.refresh_token,
			client_id: this.clientRegistration.client_id,
		};

		if (this.clientRegistration.client_secret) {
			params.client_secret = this.clientRegistration.client_secret;
		}

		const tokenRequest = toUrlSearchParams(params);

		const response = await this.client
			.getAxiosInstance()
			.post<TokenResponse>(metadata.token_endpoint, tokenRequest, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			});

		this.logger.debug("Token refresh successful");

		await this.saveTokens(response.data);

		return response.data;
	}

	/**
	 * Save token response to secrets storage and restart the refresh timer.
	 */
	private async saveTokens(tokenResponse: TokenResponse): Promise<void> {
		const expiryTimestamp = tokenResponse.expires_in
			? Date.now() + tokenResponse.expires_in * 1000
			: Date.now() + 3600 * 1000; // Default to 1 hour if not specified

		const tokens: StoredOAuthTokens = {
			...tokenResponse,
			expiry_timestamp: expiryTimestamp,
		};

		this.storedTokens = tokens;
		await this.secretsManager.setOAuthTokens(tokens);

		this.logger.info("Tokens saved", {
			expires_at: new Date(expiryTimestamp).toISOString(),
		});

		// Restart timer with new expiry (creates self-perpetuating refresh cycle)
		this.startRefreshTimer();
	}

	/**
	 * Start the background token refresh timer.
	 * Sets a timeout to fire exactly when the token is 5 minutes from expiry.
	 */
	private startRefreshTimer(): void {
		this.stopRefreshTimer();

		if (!this.storedTokens?.refresh_token) {
			this.logger.debug("No refresh token available, skipping timer setup");
			return;
		}

		const now = Date.now();
		const timeUntilRefresh =
			this.storedTokens.expiry_timestamp - TOKEN_REFRESH_THRESHOLD_MS - now;

		// If token is already expired or expires very soon, refresh immediately
		if (timeUntilRefresh <= 0) {
			this.logger.info("Token needs immediate refresh");
			this.refreshToken().catch((error) => {
				this.logger.error("Immediate token refresh failed:", error);
			});
			return;
		}

		// Set timeout to fire exactly when token is 5 minutes from expiry
		this.refreshTimer = setTimeout(() => {
			this.logger.debug("Token refresh timer fired, refreshing token...");
			this.refreshToken().catch((error) => {
				this.logger.error("Scheduled token refresh failed:", error);
			});
		}, timeUntilRefresh);

		this.logger.debug("Token refresh timer scheduled", {
			fires_at: new Date(now + timeUntilRefresh).toISOString(),
			fires_in: timeUntilRefresh / 1000,
		});
	}

	/**
	 * Stop the background token refresh timer.
	 */
	private stopRefreshTimer(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
			this.logger.debug("Background token refresh timer stopped");
		}
	}

	/**
	 * Revoke a token using the OAuth server's revocation endpoint.
	 */
	private async revokeToken(
		token: string,
		tokenTypeHint?: "access_token" | "refresh_token",
	): Promise<void> {
		if (!this.clientRegistration) {
			throw new Error("No client registration found");
		}

		const metadata = await this.getMetadata();

		if (!metadata.revocation_endpoint) {
			this.logger.warn(
				"Server does not support token revocation (no revocation_endpoint)",
			);
			return;
		}

		this.logger.info("Revoking token", { tokenTypeHint });

		const params: TokenRevocationRequest = {
			token,
			client_id: this.clientRegistration.client_id,
		};

		if (tokenTypeHint) {
			params.token_type_hint = tokenTypeHint;
		}

		if (this.clientRegistration.client_secret) {
			params.client_secret = this.clientRegistration.client_secret;
		}

		const revocationRequest = toUrlSearchParams(params);

		try {
			await this.client
				.getAxiosInstance()
				.post(metadata.revocation_endpoint, revocationRequest, {
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
		this.stopRefreshTimer();

		// Revoke refresh token (which also invalidates access token per RFC 7009)
		if (this.storedTokens?.refresh_token) {
			try {
				await this.revokeToken(
					this.storedTokens.refresh_token,
					"refresh_token",
				);
			} catch (error) {
				this.logger.warn("Token revocation failed during logout:", error);
			}
		}

		// Clear stored tokens
		await this.secretsManager.clearOAuthTokens();
		this.storedTokens = undefined;

		// Clear client registration
		await this.clearClientRegistration();

		// Trigger logout state change for other windows
		// await this.secretsManager.triggerLoginStateChange("logout");

		this.logger.info("Logout complete");
	}

	/**
	 * Cleanup method to be called when disposing the helper.
	 */
	dispose(): void {
		this.stopRefreshTimer();
	}
}

function includesAllTypes(
	arr: string[] | undefined,
	requiredTypes: readonly string[],
): boolean {
	if (arr === undefined) {
		// Supported types are not sent by the server so just assume everything is allowed
		return true;
	}

	return requiredTypes.every((type) => arr.includes(type));
}

/**
 * Converts an object with string properties to Record<string, string>,
 * filtering out undefined values for use with URLSearchParams.
 */
function toUrlSearchParams(obj: object): URLSearchParams {
	const params = Object.fromEntries(
		Object.entries(obj).filter(
			([, value]) => value !== undefined && typeof value === "string",
		),
	) as Record<string, string>;

	return new URLSearchParams(params);
}

/**
 * Activates OAuth support for the Coder extension.
 * Initializes the OAuth helper and registers the test auth command.
 */
export async function activateCoderOAuth(
	client: CoderApi,
	secretsManager: SecretsManager,
	logger: Logger,
	context: vscode.ExtensionContext,
): Promise<CoderOAuthHelper> {
	const oauthHelper = await CoderOAuthHelper.create(
		client,
		secretsManager,
		logger,
		context,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("coder.oauth.login", async () => {
			try {
				const { code, verifier } = await oauthHelper.startAuthorization();

				const tokenResponse = await oauthHelper.exchangeToken(code, verifier);

				logger.info("OAuth flow completed:", {
					token_type: tokenResponse.token_type,
					expires_in: tokenResponse.expires_in,
					scope: tokenResponse.scope,
				});

				vscode.window.showInformationMessage(
					`OAuth flow completed! Access token received (expires in ${tokenResponse.expires_in}s)`,
				);

				// Test API call to verify token works
				client.setSessionToken(tokenResponse.access_token);
				await client.getWorkspaces({ q: "owner:me" });
			} catch (error) {
				vscode.window.showErrorMessage(`OAuth flow failed: ${error}`);
				logger.error("OAuth flow failed:", error);
			}
		}),
		vscode.commands.registerCommand("coder.oauth.logout", async () => {
			try {
				await oauthHelper.logout();
				vscode.window.showInformationMessage("Successfully logged out");
				logger.info("User logged out via OAuth");
			} catch (error) {
				vscode.window.showErrorMessage(`Logout failed: ${error}`);
				logger.error("OAuth logout failed:", error);
			}
		}),
	);

	return oauthHelper;
}
