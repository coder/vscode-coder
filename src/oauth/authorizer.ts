import { type AxiosInstance } from "axios";
import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { type SecretsManager } from "../core/secretsManager";
import { type Deployment } from "../deployment/types";
import { type Logger } from "../logging/logger";

import {
	AUTH_GRANT_TYPE,
	DEFAULT_OAUTH_SCOPES,
	PKCE_CHALLENGE_METHOD,
	RESPONSE_TYPE,
	TOKEN_ENDPOINT_AUTH_METHOD,
} from "./constants";
import { OAuthMetadataClient } from "./metadataClient";
import {
	CALLBACK_PATH,
	generatePKCE,
	generateState,
	toUrlSearchParams,
} from "./utils";

import type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ClientRegistrationRequest,
	OAuth2ClientRegistrationResponse,
	OAuth2TokenRequest,
	OAuth2TokenResponse,
	User,
} from "coder/site/src/api/typesGenerated";

/**
 * Handles the OAuth authorization code flow for authenticating with Coder deployments.
 * Encapsulates client registration, PKCE challenge, and token exchange.
 */
export class OAuthAuthorizer implements vscode.Disposable {
	private pendingAuthReject: ((error: Error) => void) | null = null;

	constructor(
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
		private readonly extensionId: string,
	) {}

	/**
	 * Perform complete OAuth login flow.
	 * Creates CoderApi internally from deployment.
	 * Returns the token response and user - does not persist tokens.
	 */
	public async login(
		deployment: Deployment,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		cancellationToken: vscode.CancellationToken,
	): Promise<{ tokenResponse: OAuth2TokenResponse; user: User }> {
		const reportProgress = (message?: string, increment?: number): void => {
			if (cancellationToken.isCancellationRequested) {
				throw new Error("OAuth login cancelled by user");
			}
			progress.report({ message, increment });
		};

		const client = CoderApi.create(deployment.url, undefined, this.logger);
		const axiosInstance = client.getAxiosInstance();

		reportProgress("fetching metadata...", 10);
		const metadataClient = new OAuthMetadataClient(axiosInstance, this.logger);
		const metadata = await metadataClient.getMetadata();

		reportProgress("registering client...", 10);
		const registration = await this.registerClient(
			deployment,
			axiosInstance,
			metadata,
		);

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

		// Set token on client to fetch user
		client.setSessionToken(tokenResponse.access_token);

		reportProgress("fetching user...", 20);
		const user = await client.getAuthenticatedUser();

		this.logger.info("OAuth login flow completed successfully");

		return {
			tokenResponse,
			user,
		};
	}

	/**
	 * Get the redirect URI for OAuth callbacks.
	 */
	private getRedirectUri(): string {
		return `${vscode.env.uriScheme}://${this.extensionId}${CALLBACK_PATH}`;
	}

	/**
	 * Register OAuth client or return existing if still valid.
	 * Re-registers if redirect URI has changed.
	 */
	private async registerClient(
		deployment: Deployment,
		axiosInstance: AxiosInstance,
		metadata: OAuth2AuthorizationServerMetadata,
	): Promise<OAuth2ClientRegistrationResponse> {
		const redirectUri = this.getRedirectUri();

		const existing = await this.secretsManager.getOAuthClientRegistration(
			deployment.safeHostname,
		);
		if (existing?.client_id) {
			if (existing.redirect_uris?.includes(redirectUri)) {
				this.logger.debug(
					"Using existing client registration:",
					existing.client_id,
				);
				return existing;
			}
			this.logger.debug("Redirect URI changed, re-registering client");
		}

		if (!metadata.registration_endpoint) {
			throw new Error("Server does not support dynamic client registration");
		}

		const registrationRequest: OAuth2ClientRegistrationRequest = {
			redirect_uris: [redirectUri],
			grant_types: [AUTH_GRANT_TYPE],
			response_types: [RESPONSE_TYPE],
			client_name: `Coder for ${vscode.env.appName}`,
			token_endpoint_auth_method: TOKEN_ENDPOINT_AUTH_METHOD,
		};

		const response = await axiosInstance.post<OAuth2ClientRegistrationResponse>(
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
	}

	/**
	 * Build authorization URL with all required OAuth 2.1 parameters.
	 */
	private buildAuthorizationUrl(
		metadata: OAuth2AuthorizationServerMetadata,
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
		metadata: OAuth2AuthorizationServerMetadata,
		registration: OAuth2ClientRegistrationResponse,
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
				// Reject any existing pending auth before starting a new one
				if (this.pendingAuthReject) {
					this.pendingAuthReject(new Error("New OAuth flow started"));
				}
				this.pendingAuthReject = reject;

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
							this.logger.warn(
								"Ignoring OAuth callback with mismatched state",
								{ expected: state, received: callbackState },
							);
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
					this.pendingAuthReject = null;
					clearTimeout(timeoutHandle);
					listener.dispose();
					cancellationListener.dispose();
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
	 * Exchange authorization code for access token.
	 */
	private async exchangeToken(
		code: string,
		verifier: string,
		axiosInstance: AxiosInstance,
		metadata: OAuth2AuthorizationServerMetadata,
		registration: OAuth2ClientRegistrationResponse,
	): Promise<OAuth2TokenResponse> {
		this.logger.debug("Exchanging authorization code for token");

		const params: OAuth2TokenRequest = {
			grant_type: AUTH_GRANT_TYPE,
			code,
			redirect_uri: this.getRedirectUri(),
			client_id: registration.client_id,
			client_secret: registration.client_secret,
			code_verifier: verifier,
		};

		const tokenRequest = toUrlSearchParams(params);

		const response = await axiosInstance.post<OAuth2TokenResponse>(
			metadata.token_endpoint,
			tokenRequest,
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			},
		);

		this.logger.debug("Token exchange successful");

		return response.data;
	}

	public dispose(): void {
		if (this.pendingAuthReject) {
			this.pendingAuthReject(new Error("OAuthAuthorizer disposed"));
			this.pendingAuthReject = null;
		}
	}
}
