import type { AxiosInstance } from "axios";

import type { Logger } from "../logging/logger";

import type {
	GrantType,
	OAuthServerMetadata,
	ResponseType,
	TokenEndpointAuthMethod,
} from "./types";

const OAUTH_DISCOVERY_ENDPOINT = "/.well-known/oauth-authorization-server";

const AUTH_GRANT_TYPE = "authorization_code" as const;
const REFRESH_GRANT_TYPE = "refresh_token" as const;
const RESPONSE_TYPE = "code" as const;
const OAUTH_METHOD = "client_secret_post" as const;
const PKCE_CHALLENGE_METHOD = "S256" as const;

const REQUIRED_GRANT_TYPES = [AUTH_GRANT_TYPE, REFRESH_GRANT_TYPE] as const;

// RFC 8414 defaults when fields are omitted
const DEFAULT_GRANT_TYPES = [AUTH_GRANT_TYPE] as GrantType[];
const DEFAULT_RESPONSE_TYPES = [RESPONSE_TYPE] as ResponseType[];
const DEFAULT_AUTH_METHODS = [
	"client_secret_basic",
] as TokenEndpointAuthMethod[];

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
		const supported = metadata.grant_types_supported ?? DEFAULT_GRANT_TYPES;
		if (!includesAllTypes(supported, REQUIRED_GRANT_TYPES)) {
			throw new Error(
				`Server does not support required grant types: ${REQUIRED_GRANT_TYPES.join(", ")}. Supported: ${supported.join(", ")}`,
			);
		}
	}

	private validateResponseTypes(metadata: OAuthServerMetadata): void {
		const supported =
			metadata.response_types_supported ?? DEFAULT_RESPONSE_TYPES;
		if (!includesAllTypes(supported, [RESPONSE_TYPE])) {
			throw new Error(
				`Server does not support required response type: ${RESPONSE_TYPE}. Supported: ${supported.join(", ")}`,
			);
		}
	}

	private validateAuthMethods(metadata: OAuthServerMetadata): void {
		const supported =
			metadata.token_endpoint_auth_methods_supported ?? DEFAULT_AUTH_METHODS;
		if (!includesAllTypes(supported, [OAUTH_METHOD])) {
			throw new Error(
				`Server does not support required auth method: ${OAUTH_METHOD}. Supported: ${supported.join(", ")}`,
			);
		}
	}

	private validatePKCEMethods(metadata: OAuthServerMetadata): void {
		// PKCE has no RFC 8414 default - if undefined, server doesn't advertise support
		const supported = metadata.code_challenge_methods_supported ?? [];
		if (!includesAllTypes(supported, [PKCE_CHALLENGE_METHOD])) {
			throw new Error(
				`Server does not support required PKCE method: ${PKCE_CHALLENGE_METHOD}. Supported: ${supported.length > 0 ? supported.join(", ") : "none"}`,
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
