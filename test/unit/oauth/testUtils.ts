import { vi } from "vitest";

import { SecretsManager } from "@/core/secretsManager";
import { getHeaders } from "@/headers";

import {
	createMockLogger,
	getAxiosMockAdapter,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
	setupAxiosMockRoutes,
} from "../../mocks/testHelpers";

import type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ClientRegistrationResponse,
	OAuth2TokenResponse,
} from "coder/site/src/api/typesGenerated";

import type { Deployment } from "@/deployment/types";

export const TEST_URL = "https://coder.example.com";
export const TEST_HOSTNAME = "coder.example.com";

export function createMockOAuthMetadata(
	issuer: string,
	overrides: Partial<OAuth2AuthorizationServerMetadata> = {},
): OAuth2AuthorizationServerMetadata {
	return {
		issuer,
		authorization_endpoint: `${issuer}/oauth2/authorize`,
		token_endpoint: `${issuer}/oauth2/token`,
		revocation_endpoint: `${issuer}/oauth2/revoke`,
		registration_endpoint: `${issuer}/oauth2/register`,
		scopes_supported: [
			"workspace:read",
			"workspace:update",
			"workspace:start",
			"workspace:ssh",
			"workspace:application_connect",
			"template:read",
			"user:read_personal",
		],
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["client_secret_post"],
		...overrides,
	};
}

export function createMockClientRegistration(
	overrides: Partial<OAuth2ClientRegistrationResponse> = {},
): OAuth2ClientRegistrationResponse {
	return {
		client_id: "test-client-id",
		client_secret: "test-client-secret",
		client_id_issued_at: Math.floor(Date.now() / 1000),
		redirect_uris: ["vscode://coder.coder-remote/oauth/callback"],
		token_endpoint_auth_method: "client_secret_post",
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		registration_access_token: "test-registration-access-token",
		registration_client_uri: `${TEST_URL}/oauth2/register/test-client-id`,
		...overrides,
	};
}

/**
 * Creates a mock OAuth token response for testing.
 */
export function createMockTokenResponse(
	overrides: Partial<OAuth2TokenResponse> = {},
): OAuth2TokenResponse {
	return {
		access_token: "test-access-token",
		refresh_token: "test-refresh-token",
		token_type: "Bearer",
		expires_in: 3600,
		scope: "workspace:read workspace:update",
		...overrides,
	};
}

export function createTestDeployment(): Deployment {
	return {
		url: TEST_URL,
		safeHostname: TEST_HOSTNAME,
	};
}

export function createBaseTestContext() {
	const mockAdapter = getAxiosMockAdapter();
	vi.mocked(getHeaders).mockResolvedValue({});

	// Constructor sets up vscode.workspace mock
	const _configurationProvider = new MockConfigurationProvider();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);

	/** Sets up default OAuth routes - use explicit routes when asserting on values */
	const setupOAuthRoutes = () => {
		setupAxiosMockRoutes(mockAdapter, {
			"/.well-known/oauth-authorization-server":
				createMockOAuthMetadata(TEST_URL),
			"/oauth2/register": createMockClientRegistration(),
			"/oauth2/token": createMockTokenResponse(),
			"/api/v2/users/me": { username: "test-user" },
		});
	};

	return { mockAdapter, secretsManager, logger, setupOAuthRoutes };
}
