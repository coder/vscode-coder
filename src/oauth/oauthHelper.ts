import * as vscode from "vscode";

import { type CoderApi } from "../api/coderApi";
import { type SecretsManager } from "../core/secretsManager";

import { CALLBACK_PATH, generatePKCE, generateState } from "./utils";

import type { Logger } from "../logging/logger";

import type {
	AuthorizationRequestParams,
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	OAuthServerMetadata,
	TokenRequestParams,
	TokenResponse,
} from "./types";

const AUTH_GRANT_TYPE = "authorization_code" as const;
const REFRESH_GRANT_TYPE = "refresh_token" as const;
const RESPONSE_TYPE = "code" as const;
const OAUTH_METHOD = "client_secret_post" as const;
const PKCE_CHALLENGE_METHOD = "S256" as const;
const CLIENT_NAME = "VS Code Coder Extension";

const REQUIRED_GRANT_TYPES = [AUTH_GRANT_TYPE, REFRESH_GRANT_TYPE] as const;

export class CoderOAuthHelper {
	private clientRegistration: ClientRegistrationResponse | undefined;
	private cachedMetadata: OAuthServerMetadata | undefined;
	private pendingAuthResolve:
		| ((value: { code: string; verifier: string }) => void)
		| undefined;
	private pendingAuthReject: ((reason: Error) => void) | undefined;
	private expectedState: string | undefined;
	private pendingVerifier: string | undefined;

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
		this.logger.info("OAuth endpoints discovered:", {
			authorization: metadata.authorization_endpoint,
			token: metadata.token_endpoint,
			registration: metadata.registration_endpoint,
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

		const registrationRequest: ClientRegistrationRequest = {
			redirect_uris: [redirectUri],
			application_type: "native",
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
		scope = "all",
	): string {
		if (
			metadata.scopes_supported &&
			!metadata.scopes_supported.includes(scope)
		) {
			this.logger.warn(
				`Requested scope "${scope}" not in server's supported scopes. Server may still accept it.`,
				{ supported_scopes: metadata.scopes_supported },
			);
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

		this.logger.info("OAuth Authorization URL:", url);
		this.logger.info("Client ID:", clientId);
		this.logger.info("Redirect URI:", this.getRedirectUri());
		this.logger.info("Scope:", scope);

		return url;
	}

	async startAuthorization(
		scope = "all",
	): Promise<{ code: string; verifier: string }> {
		const metadata = await this.getMetadata();
		const clientId = await this.registerClient();
		const state = generateState();
		const { verifier, challenge } = generatePKCE();

		const authUrl = this.buildAuthorizationUrl(
			metadata,
			clientId,
			state,
			challenge,
			scope,
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

		const tokenRequest = new URLSearchParams(
			params as unknown as Record<string, string>,
		);

		const response = await this.client
			.getAxiosInstance()
			.post<TokenResponse>(metadata.token_endpoint, tokenRequest.toString(), {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			});

		this.logger.info("Token exchange successful");
		return response.data;
	}

	getClientId(): string | undefined {
		return this.clientRegistration?.client_id;
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
		vscode.commands.registerCommand("coder.oauth.testAuth", async () => {
			try {
				const { code, verifier } = await oauthHelper.startAuthorization();
				logger.info(
					"Authorization code received:",
					code.substring(0, 8) + "...",
				);

				const tokenResponse = await oauthHelper.exchangeToken(code, verifier);

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
