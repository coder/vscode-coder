import {
	AUTH_GRANT_TYPE,
	PKCE_CHALLENGE_METHOD,
	REFRESH_GRANT_TYPE,
	RESPONSE_TYPE,
	TOKEN_ENDPOINT_AUTH_METHOD,
} from "./constants";

import type { AxiosInstance } from "axios";
import type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ProviderGrantType,
	OAuth2ProviderResponseType,
	OAuth2TokenEndpointAuthMethod,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

const OAUTH_DISCOVERY_ENDPOINT = "/.well-known/oauth-authorization-server";

const REQUIRED_GRANT_TYPES: readonly string[] = [
	AUTH_GRANT_TYPE,
	REFRESH_GRANT_TYPE,
];

// RFC 8414 defaults when fields are omitted
const DEFAULT_GRANT_TYPES: readonly OAuth2ProviderGrantType[] = [
	AUTH_GRANT_TYPE,
];
const DEFAULT_RESPONSE_TYPES: readonly OAuth2ProviderResponseType[] = [
	RESPONSE_TYPE,
];
const DEFAULT_AUTH_METHODS: readonly OAuth2TokenEndpointAuthMethod[] = [
	"client_secret_basic",
];

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
	public static async checkOAuthSupport(
		axiosInstance: AxiosInstance,
	): Promise<boolean> {
		try {
			await axiosInstance.get(OAUTH_DISCOVERY_ENDPOINT);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Fetch and validate OAuth server metadata.
	 * Throws detailed errors if server doesn't meet OAuth 2.1 requirements.
	 */
	async getMetadata(): Promise<OAuth2AuthorizationServerMetadata> {
		this.logger.debug("Discovering OAuth endpoints...");

		const response =
			await this.axiosInstance.get<OAuth2AuthorizationServerMetadata>(
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

	private validateRequiredEndpoints(
		metadata: OAuth2AuthorizationServerMetadata,
	): void {
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

	private validateGrantTypes(
		metadata: OAuth2AuthorizationServerMetadata,
	): void {
		const supported = metadata.grant_types_supported ?? DEFAULT_GRANT_TYPES;
		if (!includesAllTypes(supported, REQUIRED_GRANT_TYPES)) {
			throw new Error(
				`Server does not support required grant types: ${REQUIRED_GRANT_TYPES.join(", ")}. Supported: ${formatSupported(supported)}`,
			);
		}
	}

	private validateResponseTypes(
		metadata: OAuth2AuthorizationServerMetadata,
	): void {
		const supported =
			metadata.response_types_supported ?? DEFAULT_RESPONSE_TYPES;
		if (!includesAllTypes(supported, [RESPONSE_TYPE])) {
			throw new Error(
				`Server does not support required response type: ${RESPONSE_TYPE}. Supported: ${formatSupported(supported)}`,
			);
		}
	}

	private validateAuthMethods(
		metadata: OAuth2AuthorizationServerMetadata,
	): void {
		const supported =
			metadata.token_endpoint_auth_methods_supported ?? DEFAULT_AUTH_METHODS;
		if (!includesAllTypes(supported, [TOKEN_ENDPOINT_AUTH_METHOD])) {
			throw new Error(
				`Server does not support required auth method: ${TOKEN_ENDPOINT_AUTH_METHOD}. Supported: ${formatSupported(supported)}`,
			);
		}
	}

	private validatePKCEMethods(
		metadata: OAuth2AuthorizationServerMetadata,
	): void {
		// PKCE has no RFC 8414 default - if undefined, server doesn't advertise support
		const supported = metadata.code_challenge_methods_supported ?? [];
		if (!includesAllTypes(supported, [PKCE_CHALLENGE_METHOD])) {
			throw new Error(
				`Server does not support required PKCE method: ${PKCE_CHALLENGE_METHOD}. Supported: ${formatSupported(supported)}`,
			);
		}
	}
}

/**
 * Check if an array includes all required types.
 */
function includesAllTypes(
	arr: readonly string[],
	requiredTypes: readonly string[],
): boolean {
	return requiredTypes.every((type) => arr.includes(type));
}

function formatSupported(supported: readonly string[]): string {
	return supported.length > 0 ? supported.join(", ") : "none";
}
