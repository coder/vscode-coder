import type { AxiosInstance } from "axios";

import type { Logger } from "../logging/logger";

import type { OAuthServerMetadata } from "./types";

const OAUTH_DISCOVERY_ENDPOINT = "/.well-known/oauth-authorization-server";

const AUTH_GRANT_TYPE = "authorization_code" as const;
const REFRESH_GRANT_TYPE = "refresh_token" as const;
const RESPONSE_TYPE = "code" as const;
const OAUTH_METHOD = "client_secret_post" as const;
const PKCE_CHALLENGE_METHOD = "S256" as const;

const REQUIRED_GRANT_TYPES = [AUTH_GRANT_TYPE, REFRESH_GRANT_TYPE] as const;

/**
 * Client for discovering and validating OAuth server metadata.
 */
export class OAuthMetadataClient {
	constructor(
		private readonly axiosInstance: AxiosInstance,
		private readonly logger: Logger,
	) {}

	/**
	 * Check if a server supports OAuth by attempting to fetch the well-known endpoint.
	 */
	async checkOAuthSupport(): Promise<boolean> {
		try {
			await this.axiosInstance.get(OAUTH_DISCOVERY_ENDPOINT);
			this.logger.debug("Server supports OAuth");
			return true;
		} catch (error) {
			this.logger.debug("Server does not support OAuth:", error);
			return false;
		}
	}

	/**
	 * Fetch and validate OAuth server metadata.
	 * Throws detailed errors if server doesn't meet OAuth 2.1 requirements.
	 */
	async getMetadata(): Promise<OAuthServerMetadata> {
		this.logger.debug("Discovering OAuth endpoints...");

		const response = await this.axiosInstance.get<OAuthServerMetadata>(
			OAUTH_DISCOVERY_ENDPOINT,
		);

		const metadata = response.data;

		this.validateRequiredEndpoints(metadata);
		this.validateGrantTypes(metadata);
		this.validateResponseTypes(metadata);
		this.validateAuthMethods(metadata);
		this.validatePKCEMethods(metadata);

		this.logger.debug("OAuth endpoints discovered:", {
			authorization: metadata.authorization_endpoint,
			token: metadata.token_endpoint,
			registration: metadata.registration_endpoint,
			revocation: metadata.revocation_endpoint,
		});

		return metadata;
	}

	private validateRequiredEndpoints(metadata: OAuthServerMetadata): void {
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
	}

	private validateGrantTypes(metadata: OAuthServerMetadata): void {
		if (
			!includesAllTypes(metadata.grant_types_supported, REQUIRED_GRANT_TYPES)
		) {
			throw new Error(
				`Server does not support required grant types: ${REQUIRED_GRANT_TYPES.join(", ")}. Supported: ${metadata.grant_types_supported?.join(", ") || "none"}`,
			);
		}
	}

	private validateResponseTypes(metadata: OAuthServerMetadata): void {
		if (!includesAllTypes(metadata.response_types_supported, [RESPONSE_TYPE])) {
			throw new Error(
				`Server does not support required response type: ${RESPONSE_TYPE}. Supported: ${metadata.response_types_supported?.join(", ") || "none"}`,
			);
		}
	}

	private validateAuthMethods(metadata: OAuthServerMetadata): void {
		if (
			!includesAllTypes(metadata.token_endpoint_auth_methods_supported, [
				OAUTH_METHOD,
			])
		) {
			throw new Error(
				`Server does not support required auth method: ${OAUTH_METHOD}. Supported: ${metadata.token_endpoint_auth_methods_supported?.join(", ") || "none"}`,
			);
		}
	}

	private validatePKCEMethods(metadata: OAuthServerMetadata): void {
		if (
			!includesAllTypes(metadata.code_challenge_methods_supported, [
				PKCE_CHALLENGE_METHOD,
			])
		) {
			throw new Error(
				`Server does not support required PKCE method: ${PKCE_CHALLENGE_METHOD}. Supported: ${metadata.code_challenge_methods_supported?.join(", ") || "none"}`,
			);
		}
	}
}

/**
 * Check if an array includes all required types.
 * If the array is undefined, returns true (server didn't specify, assume all allowed).
 */
function includesAllTypes(
	arr: string[] | undefined,
	requiredTypes: readonly string[],
): boolean {
	if (arr === undefined) {
		return true;
	}
	return requiredTypes.every((type) => arr.includes(type));
}
