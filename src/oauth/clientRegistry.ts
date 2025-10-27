import type { AxiosInstance } from "axios";

import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";

import type {
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	OAuthServerMetadata,
} from "./types";

const AUTH_GRANT_TYPE = "authorization_code" as const;
const RESPONSE_TYPE = "code" as const;
const OAUTH_METHOD = "client_secret_post" as const;
const CLIENT_NAME = "VS Code Coder Extension";

/**
 * Manages OAuth client registration and persistence.
 */
export class OAuthClientRegistry {
	private registration: ClientRegistrationResponse | undefined;

	constructor(
		private readonly axiosInstance: AxiosInstance,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
	) {}

	/**
	 * Load existing client registration from secure storage.
	 * Should be called during initialization.
	 */
	async load(): Promise<void> {
		const registration = await this.secretsManager.getOAuthClientRegistration();
		if (registration) {
			this.registration = registration;
			this.logger.info("Loaded existing OAuth client:", registration.client_id);
		}
	}

	/**
	 * Get the current client registration if one exists.
	 */
	get(): ClientRegistrationResponse | undefined {
		return this.registration;
	}

	/**
	 * Register a new OAuth client or return existing if still valid.
	 * Re-registers if redirect URI has changed.
	 */
	async register(
		metadata: OAuthServerMetadata,
		redirectUri: string,
	): Promise<ClientRegistrationResponse> {
		if (this.registration?.client_id) {
			if (this.registration.redirect_uris.includes(redirectUri)) {
				this.logger.info(
					"Using existing client registration:",
					this.registration.client_id,
				);
				return this.registration;
			}
			this.logger.info("Redirect URI changed, re-registering client");
		}

		if (!metadata.registration_endpoint) {
			throw new Error("Server does not support dynamic client registration");
		}

		// "web" type since VS Code Secrets API allows secure client_secret storage (confidential client)
		const registrationRequest: ClientRegistrationRequest = {
			redirect_uris: [redirectUri],
			application_type: "web",
			grant_types: [AUTH_GRANT_TYPE],
			response_types: [RESPONSE_TYPE],
			client_name: CLIENT_NAME,
			token_endpoint_auth_method: OAUTH_METHOD,
		};

		const response = await this.axiosInstance.post<ClientRegistrationResponse>(
			metadata.registration_endpoint,
			registrationRequest,
		);

		await this.save(response.data);

		return response.data;
	}

	/**
	 * Save client registration to secure storage.
	 */
	private async save(registration: ClientRegistrationResponse): Promise<void> {
		await this.secretsManager.setOAuthClientRegistration(registration);
		this.registration = registration;
		this.logger.info(
			"Saved OAuth client registration:",
			registration.client_id,
		);
	}

	/**
	 * Clear the current client registration from memory and storage.
	 */
	async clear(): Promise<void> {
		await this.secretsManager.setOAuthClientRegistration(undefined);
		this.registration = undefined;
		this.logger.info("Cleared OAuth client registration");
	}
}
