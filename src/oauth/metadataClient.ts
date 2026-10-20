import { CoderApi } from "../api/coderApi";
import { parseApiResponse } from "../api/responseValidation";
import { isSameOrigin } from "../common/url";

import {
	AUTH_GRANT_TYPE,
	PKCE_CHALLENGE_METHOD,
	REFRESH_GRANT_TYPE,
	RESPONSE_TYPE,
	TOKEN_ENDPOINT_AUTH_METHOD,
} from "./constants";
import { OAuth2AuthorizationServerMetadataSchema } from "./validation";

import type { AxiosInstance } from "axios";
import type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ProviderGrantType,
	OAuth2ProviderResponseType,
	OAuth2TokenEndpointAuthMethod,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

const OAUTH_DISCOVERY_ENDPOINT = "/.well-known/oauth-authorization-server";

/** Path-based workspace apps (`/@user/...`) serve user content on our origin. */
const WORKSPACE_APP_PATH = /\/(?:@|%40)/i;

const REQUIRED_GRANT_TYPES: readonly OAuth2ProviderGrantType[] = [
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

/** Whether a server allows OAuth sign-in, or why not. */
export type OAuthSupport =
	| "supported"
	| "registration_disabled"
	| "unsupported";

/**
 * Client for discovering and validating OAuth server metadata.
 */
export class OAuthMetadataClient {
	constructor(
		private readonly axiosInstance: AxiosInstance,
		private readonly logger: Logger,
	) {}

	/**
	 * Checks OAuth discovery for client registration, which Coder omits while
	 * dynamic client registration is off (the default from 2.37).
	 */
	public static async checkOAuthSupport(
		axiosInstance: AxiosInstance,
		logger: Logger,
	): Promise<OAuthSupport> {
		try {
			const response = await axiosInstance.get<
				Partial<OAuth2AuthorizationServerMetadata>
			>(OAUTH_DISCOVERY_ENDPOINT);
			if (response.data.registration_endpoint) {
				return "supported";
			}
			logger.warn(
				"OAuth sign-in unavailable: dynamic client registration is disabled",
			);
			return "registration_disabled";
		} catch (error) {
			logger.info("OAuth sign-in unavailable: discovery failed", error);
			return "unsupported";
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

		const metadata = parseApiResponse(
			OAuth2AuthorizationServerMetadataSchema,
			response.data,
			OAUTH_DISCOVERY_ENDPOINT,
			this.axiosInstance.defaults.baseURL,
		);

		this.validateEndpoints(metadata);
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

	/** Endpoints receive secrets, so they must belong to the deployment. */
	private validateEndpoints(metadata: OAuth2AuthorizationServerMetadata): void {
		const deploymentUrl = this.axiosInstance.defaults.baseURL ?? "";
		for (const name of [
			"authorization_endpoint",
			"token_endpoint",
			"registration_endpoint",
			"revocation_endpoint",
		] as const) {
			const endpoint = metadata[name];
			if (
				endpoint &&
				(!isSameOrigin(endpoint, deploymentUrl) ||
					WORKSPACE_APP_PATH.test(new URL(endpoint).pathname))
			) {
				throw new Error(
					`OAuth server metadata ${name} is outside the deployment`,
				);
			}
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

/** Runs `fn` with the server's OAuth metadata and a client disposed afterward. */
export async function withOAuthMetadata<T>(
	url: string,
	token: string | undefined,
	logger: Logger,
	fn: (ctx: {
		axiosInstance: AxiosInstance;
		metadata: OAuth2AuthorizationServerMetadata;
	}) => Promise<T>,
): Promise<T> {
	const client = CoderApi.create(url, token, logger);
	try {
		const axiosInstance = client.getAxiosInstance();
		const metadata = await new OAuthMetadataClient(
			axiosInstance,
			logger,
		).getMetadata();
		return await fn({ axiosInstance, metadata });
	} finally {
		client.dispose();
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
