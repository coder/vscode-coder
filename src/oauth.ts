import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { type CoderApi } from "./api/coderApi";
import { type SecretsManager } from "./core/secretsManager";

import type { Logger } from "./logging/logger";

export const CALLBACK_PATH = "/oauth/callback";

interface ClientRegistrationRequest {
	redirect_uris: string[];
	application_type: "native" | "web";
	grant_types: string[];
	response_types: string[];
	client_name: string;
	token_endpoint_auth_method:
		| "none"
		| "client_secret_post"
		| "client_secret_basic";
}

interface ClientRegistrationResponse {
	client_id: string;
	client_secret?: string;
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
	redirect_uris: string[];
	grant_types: string[];
}

interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	response_types_supported?: string[];
	grant_types_supported?: string[];
	code_challenge_methods_supported?: string[];
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

/**
 * Generate PKCE verifier and challenge (RFC 7636)
 */
function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

/**
 * OAuth helper for Coder authentication
 */
class CoderOAuthHelper {
	private _clientId: string | undefined;
	private _clientRegistration: ClientRegistrationResponse | undefined;
	private _cachedMetadata: OAuthServerMetadata | undefined;
	private _pendingAuthResolve:
		| ((value: { code: string; verifier: string }) => void)
		| undefined;
	private _pendingAuthReject: ((reason: Error) => void) | undefined;
	private _expectedState: string | undefined;
	private _pendingVerifier: string | undefined;

	private readonly extensionId: string;

	constructor(
		private readonly client: CoderApi,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		context: vscode.ExtensionContext,
	) {
		this.loadClientRegistration();
		this.extensionId = context.extension.id;
	}

	/**
	 * Discover OAuth server endpoints using RFC 8414
	 * Caches result in memory for the session
	 * Throws error if server returns 404 (OAuth not supported)
	 */
	private async discoverOAuthEndpoints(): Promise<OAuthServerMetadata> {
		if (this._cachedMetadata) {
			return this._cachedMetadata;
		}

		this.logger.info("Discovering OAuth endpoints...");

		const response = await this.client
			.getAxiosInstance()
			.request<OAuthServerMetadata>({
				url: "/.well-known/oauth-authorization-server",
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			});

		const metadata = response.data;

		// Validate required fields
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

		this._cachedMetadata = metadata;
		this.logger.info("OAuth endpoints discovered:", {
			authorization: metadata.authorization_endpoint,
			token: metadata.token_endpoint,
			registration: metadata.registration_endpoint,
		});

		return metadata;
	}

	/**
	 * Get redirect URI.
	 */
	private getRedirectUri(): string {
		return `${vscode.env.uriScheme}://${this.extensionId}${CALLBACK_PATH}`;
	}

	/**
	 * Load stored client registration from SecretsManager
	 */
	private async loadClientRegistration(): Promise<void> {
		try {
			const stored = await this.secretsManager.getOAuthClientRegistration();
			if (stored) {
				const registration = JSON.parse(stored) as ClientRegistrationResponse;
				this._clientRegistration = registration;
				this._clientId = registration.client_id;
				this.logger.info("Loaded existing OAuth client:", this._clientId);
			}
		} catch (error) {
			this.logger.error("Failed to load client registration:", error);
		}
	}

	/**
	 * Save client registration to SecretsManager
	 */
	private async saveClientRegistration(
		registration: ClientRegistrationResponse,
	): Promise<void> {
		try {
			await this.secretsManager.setOAuthClientRegistration(
				JSON.stringify(registration),
			);
			this._clientRegistration = registration;
			this._clientId = registration.client_id;
			this.logger.info("Saved OAuth client registration:", this._clientId);
		} catch (error) {
			this.logger.error("Failed to save client registration:", error);
		}
	}

	/**
	 * Clear stored client registration from SecretsManager
	 */
	async clearClientRegistration(): Promise<void> {
		await this.secretsManager.setOAuthClientRegistration(undefined);
		this._clientRegistration = undefined;
		this._clientId = undefined;
		this.logger.info("Cleared OAuth client registration");
	}

	/**
	 * Register OAuth client dynamically (RFC 7591)
	 * Uses discovered registration endpoint from OAuth server metadata
	 */
	async registerClient(): Promise<string> {
		const redirectUri = this.getRedirectUri();

		// Check if we need a new registration
		if (this._clientId && this._clientRegistration) {
			if (this._clientRegistration.redirect_uris.includes(redirectUri)) {
				this.logger.info("Using existing client registration:", this._clientId);
				return this._clientId;
			}
			this.logger.info("Redirect URI changed, re-registering client");
		}

		// Discover endpoints - will throw if 404
		const metadata = await this.discoverOAuthEndpoints();

		if (!metadata.registration_endpoint) {
			throw new Error(
				"Server does not support dynamic client registration (no registration_endpoint in metadata)",
			);
		}

		const registrationRequest: ClientRegistrationRequest = {
			redirect_uris: [redirectUri],
			application_type: "native",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			client_name: "VS Code Coder Extension",
			token_endpoint_auth_method: "client_secret_post",
		};

		this.logger.info(
			"Registering OAuth client at:",
			metadata.registration_endpoint,
		);

		const response = await this.client
			.getAxiosInstance()
			.request<ClientRegistrationResponse>({
				url: metadata.registration_endpoint,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				data: registrationRequest,
			});

		await this.saveClientRegistration(response.data);
		return response.data.client_id;
	}

	/**
	 * Generate OAuth authorization URL with PKCE
	 * Uses discovered authorization endpoint
	 */
	private generateAuthUrl(
		metadata: OAuthServerMetadata,
		clientId: string,
		state: string,
		challenge: string,
		scope = "all",
	): string {
		const params = new URLSearchParams({
			client_id: clientId,
			response_type: "code",
			redirect_uri: this.getRedirectUri(),
			scope: scope,
			state: state,
			code_challenge: challenge,
			code_challenge_method: "S256",
		});

		const url = `${metadata.authorization_endpoint}?${params.toString()}`;

		this.logger.info("OAuth Authorization URL:", url);
		this.logger.info("Client ID:", clientId);
		this.logger.info("Redirect URI:", this.getRedirectUri());
		this.logger.info("Scope:", scope);

		return url;
	}

	/**
	 * Start OAuth authorization flow
	 * Returns a promise that resolves when the callback is received with the authorization code
	 */
	async startAuthFlow(
		scope = "all",
	): Promise<{ code: string; verifier: string }> {
		// Discover endpoints first - will throw if 404
		const metadata = await this.discoverOAuthEndpoints();

		// Register client
		const clientId = await this.registerClient();

		// Generate PKCE and state (kept in closure)
		const state = randomBytes(16).toString("base64url");
		const { verifier, challenge } = generatePKCE();

		// Build auth URL with discovered endpoints
		const authUrl = this.generateAuthUrl(
			metadata,
			clientId,
			state,
			challenge,
			scope,
		);

		// Create promise that waits for callback
		return new Promise<{ code: string; verifier: string }>(
			(resolve, reject) => {
				const timeout = setTimeout(
					() => {
						this._pendingAuthResolve = undefined;
						this._pendingAuthReject = undefined;
						this._expectedState = undefined;
						this._pendingVerifier = undefined;
						reject(new Error("OAuth flow timed out after 5 minutes"));
					},
					5 * 60 * 1000,
				);

				// Store resolvers, state, and verifier for callback handler
				this._pendingAuthResolve = (result) => {
					clearTimeout(timeout);
					this._pendingAuthResolve = undefined;
					this._pendingAuthReject = undefined;
					this._expectedState = undefined;
					this._pendingVerifier = undefined;
					resolve(result);
				};

				this._pendingAuthReject = (error) => {
					clearTimeout(timeout);
					this._pendingAuthResolve = undefined;
					this._pendingAuthReject = undefined;
					this._expectedState = undefined;
					this._pendingVerifier = undefined;
					reject(error);
				};

				this._expectedState = state;
				this._pendingVerifier = verifier;

				vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
					() => {},
					(error) => {
						if (error instanceof Error) {
							this._pendingAuthReject?.(error);
						} else {
							this._pendingAuthReject?.(new Error("Failed to open browser"));
						}
					},
				);
			},
		);
	}

	/**
	 * Handle OAuth callback from URI handler
	 * Called by extension.ts when vscode:// callback is received
	 */
	handleCallback(
		code: string | null,
		state: string | null,
		error: string | null,
	): void {
		if (!this._pendingAuthResolve || !this._pendingAuthReject) {
			this.logger.warn("Received OAuth callback but no pending auth flow");
			return;
		}

		if (error) {
			this._pendingAuthReject(new Error(`OAuth error: ${error}`));
			return;
		}

		if (!code) {
			this._pendingAuthReject(new Error("No authorization code received"));
			return;
		}

		if (!state) {
			this._pendingAuthReject(new Error("No state received"));
			return;
		}

		// Get verifier from pending flow
		const verifier = this._pendingVerifier;
		if (!verifier) {
			this._pendingAuthReject(new Error("No PKCE verifier found"));
			return;
		}

		this._pendingAuthResolve({ code, verifier });
	}

	/**
	 * Exchange authorization code for access token
	 * Uses discovered token endpoint and PKCE verifier
	 */
	async exchangeCodeForToken(
		code: string,
		verifier: string,
	): Promise<TokenResponse> {
		// Discover endpoints - will throw if 404
		const metadata = await this.discoverOAuthEndpoints();

		if (!this._clientRegistration) {
			throw new Error("No client registration found");
		}

		this.logger.info("Exchanging authorization code for token");

		const tokenRequest = new URLSearchParams({
			grant_type: "authorization_code",
			code: code,
			redirect_uri: this.getRedirectUri(),
			client_id: this._clientRegistration.client_id,
			code_verifier: verifier,
		});

		// Add client secret if present
		if (this._clientRegistration.client_secret) {
			tokenRequest.append(
				"client_secret",
				this._clientRegistration.client_secret,
			);
		}

		const response = await this.client
			.getAxiosInstance()
			.request<TokenResponse>({
				url: metadata.token_endpoint,
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				data: tokenRequest.toString(),
			});

		this.logger.info("Token exchange successful");
		return response.data;
	}

	getClientId(): string | undefined {
		return this._clientId;
	}
}

/**
 * Activate OAuth functionality
 * Returns the OAuth helper instance for use by URI handler
 */
export function activateCoderOAuth(
	client: CoderApi,
	secretsManager: SecretsManager,
	logger: Logger,
	context: vscode.ExtensionContext,
): CoderOAuthHelper {
	const oauthHelper = new CoderOAuthHelper(
		client,
		secretsManager,
		logger,
		context,
	);

	// Register command to test OAuth flow
	context.subscriptions.push(
		vscode.commands.registerCommand("coder.oauth.testAuth", async () => {
			try {
				// Start OAuth flow and wait for callback
				const { code, verifier } = await oauthHelper.startAuthFlow();
				logger.info(
					"Authorization code received:",
					code.substring(0, 8) + "...",
				);

				// Exchange code for token
				const tokenResponse = await oauthHelper.exchangeCodeForToken(
					code,
					verifier,
				);

				vscode.window.showInformationMessage(
					`OAuth flow completed! Access token received (expires in ${tokenResponse.expires_in}s)`,
				);
				logger.info("OAuth flow completed:", {
					token_type: tokenResponse.token_type,
					expires_in: tokenResponse.expires_in,
					scope: tokenResponse.scope,
				});

				client.setSessionToken(tokenResponse.access_token);
				const response = await client.getWorkspaces({ q: "owner:me" });
				logger.info(response.workspaces.map((w) => w.name).toString());
			} catch (error) {
				vscode.window.showErrorMessage(`OAuth flow failed: ${error}`);
				logger.error("OAuth flow failed:", error);
			}
		}),
	);

	return oauthHelper;
}
