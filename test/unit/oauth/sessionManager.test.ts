import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { type ServiceContainer } from "@/core/container";
import { SecretsManager, type SessionAuth } from "@/core/secretsManager";
import { getHeaders } from "@/headers";
import { InvalidGrantError } from "@/oauth/errors";
import { OAuthSessionManager } from "@/oauth/sessionManager";

import {
	createMockLogger,
	createMockTokenResponse,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { Deployment } from "@/deployment/types";
import type { LoginCoordinator } from "@/login/loginCoordinator";
import type {
	ClientRegistrationResponse,
	OAuthServerMetadata,
} from "@/oauth/types";

// Hoisted mock implementations
const mockAxiosAdapterImpl = vi.hoisted(
	() => (config: Record<string, unknown>) =>
		Promise.resolve({
			data: config.data || "{}",
			status: 200,
			statusText: "OK",
			headers: {},
			config,
		}),
);

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");
	const mockAdapter = vi.fn();
	return {
		...actual,
		default: {
			...actual.default,
			create: vi.fn((config) =>
				actual.default.create({ ...config, adapter: mockAdapter }),
			),
			__mockAdapter: mockAdapter,
		},
	};
});

vi.mock("@/headers", () => ({
	getHeaders: vi.fn().mockResolvedValue({}),
	getHeaderCommand: vi.fn(),
}));

vi.mock("@/api/utils", async () => {
	const actual =
		await vi.importActual<typeof import("@/api/utils")>("@/api/utils");
	return { ...actual, createHttpAgent: vi.fn() };
});

type MockedAxios = typeof axios & { __mockAdapter: ReturnType<typeof vi.fn> };

function createMockOAuthMetadata(
	issuer: string,
	overrides: Partial<OAuthServerMetadata> = {},
): OAuthServerMetadata {
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
		...overrides,
	};
}

/**
 * Creates a mock OAuth client registration response for testing.
 */
function createMockClientRegistration(
	overrides: Partial<ClientRegistrationResponse> = {},
): ClientRegistrationResponse {
	return {
		client_id: "test-client-id",
		client_secret: "test-client-secret",
		redirect_uris: ["vscode://coder.coder-remote/oauth/callback"],
		token_endpoint_auth_method: "client_secret_post",
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		...overrides,
	};
}

function setupAxiosRoutes(
	mockAdapter: ReturnType<typeof vi.fn>,
	routes: Record<string, unknown>,
) {
	mockAdapter.mockImplementation((config: { url?: string }) => {
		for (const [pattern, data] of Object.entries(routes)) {
			if (config.url?.includes(pattern)) {
				return Promise.resolve({
					data,
					status: 200,
					statusText: "OK",
					headers: {},
					config,
				});
			}
		}
		return Promise.reject(new Error(`No route matched: ${config.url}`));
	});
}

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";
const EXTENSION_ID = "coder.coder-remote";

// Time constants (in milliseconds)
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const REFRESH_BUFFER_MS = FIVE_MINUTES_MS; // Tokens refresh 5 minutes before expiry

function createTestDeployment(): Deployment {
	return {
		url: TEST_URL,
		safeHostname: TEST_HOSTNAME,
	};
}

function createMockLoginCoordinator(): LoginCoordinator {
	return {
		ensureLoggedIn: vi.fn(),
		ensureLoggedInWithDialog: vi.fn(),
	} as unknown as LoginCoordinator;
}

function createTestContext() {
	vi.resetAllMocks();

	const mockAdapter = (axios as MockedAxios).__mockAdapter;
	mockAdapter.mockImplementation(mockAxiosAdapterImpl);
	vi.mocked(getHeaders).mockResolvedValue({});

	// Constructor sets up vscode.workspace mock
	const _mockConfig = new MockConfigurationProvider();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);
	const loginCoordinator = createMockLoginCoordinator();

	const metadata = createMockOAuthMetadata(TEST_URL);
	const registration = createMockClientRegistration();
	const tokenResponse = createMockTokenResponse();
	const user = createMockUser();

	const setupOAuthRoutes = () => {
		setupAxiosRoutes(mockAdapter, {
			"/.well-known/oauth-authorization-server": metadata,
			"/oauth2/register": registration,
			"/oauth2/token": tokenResponse,
			"/api/v2/users/me": user,
		});
	};

	return {
		mockAdapter,
		secretsManager,
		logger,
		loginCoordinator,
		metadata,
		registration,
		tokenResponse,
		user,
		setupOAuthRoutes,
	};
}

// Create a minimal service container for testing
function createMockServiceContainer(
	secretsManager: SecretsManager,
	logger: ReturnType<typeof createMockLogger>,
	loginCoordinator: LoginCoordinator,
): ServiceContainer {
	return {
		getSecretsManager: () => secretsManager,
		getLogger: () => logger,
		getLoginCoordinator: () => loginCoordinator,
	} as ServiceContainer;
}

describe("OAuthSessionManager", () => {
	describe("isLoggedInWithOAuth", () => {
		type IsLoggedInTestCase = {
			name: string;
			auth: SessionAuth | null;
			expected: boolean;
		};

		it.each<IsLoggedInTestCase>([
			{
				name: "returns true when OAuth tokens exist",
				auth: {
					url: TEST_URL,
					token: "access-token",
					oauth: {
						token_type: "Bearer",
						refresh_token: "refresh-token",
						expiry_timestamp: Date.now() + ONE_HOUR_MS,
					},
				},
				expected: true,
			},
			{
				name: "returns false when no tokens exist",
				auth: null,
				expected: false,
			},
			{
				name: "returns false when session auth has no OAuth data",
				auth: { url: TEST_URL, token: "session-token" },
				expected: false,
			},
		])("$name", async ({ auth, expected }) => {
			const { secretsManager, logger, loginCoordinator } = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			if (auth) {
				await secretsManager.setSessionAuth(TEST_HOSTNAME, auth);
			}

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(expected);
		});
	});

	describe("handleCallback", () => {
		type RouteConfig =
			| "full"
			| { metadata: true; registration: true; token?: false };

		async function startOAuthLogin(routeConfig: RouteConfig = "full") {
			vi.useRealTimers();

			const ctx = createTestContext();
			const container = createMockServiceContainer(
				ctx.secretsManager,
				ctx.logger,
				ctx.loginCoordinator,
			);
			const manager = OAuthSessionManager.create(null, container, EXTENSION_ID);
			const deployment = createTestDeployment();

			if (routeConfig === "full") {
				ctx.setupOAuthRoutes();
			} else {
				setupAxiosRoutes(ctx.mockAdapter, {
					"/.well-known/oauth-authorization-server": ctx.metadata,
					"/oauth2/register": ctx.registration,
				});
			}

			let authUrl: string | undefined;
			vi.mocked(vscode.env.openExternal).mockImplementation((uri) => {
				authUrl = uri.toString();
				return Promise.resolve(true);
			});

			const progress = { report: vi.fn() };
			const cancellationToken: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
			};

			const loginPromise = manager.login(
				deployment,
				progress,
				cancellationToken,
			);

			await vi.waitFor(() => expect(authUrl).toBeDefined());

			const state = new URLSearchParams(new URL(authUrl!).search).get("state");

			return { manager, loginPromise, state, authUrl, ...ctx };
		}

		it("resolves login promise when callback with code received", async () => {
			const { manager, loginPromise, state, user } = await startOAuthLogin();

			await manager.handleCallback("auth-code", state, null);

			const result = await loginPromise;
			expect(result.token).toBe("test-access-token");
			expect(result.user.id).toBe(user.id);
		});

		it("rejects login promise when callback with error received", async () => {
			const { manager, loginPromise, state } = await startOAuthLogin({
				metadata: true,
				registration: true,
			});

			await manager.handleCallback(null, state, "access_denied");

			await expect(loginPromise).rejects.toThrow("access_denied");
		});

		it("ignores callback with wrong state, resolves with correct state", async () => {
			const { manager, loginPromise, state, user } = await startOAuthLogin();

			// Callback with wrong state should be ignored
			await manager.handleCallback("auth-code", "wrong-state", null);

			// Verify promise is still pending by checking it hasn't resolved yet
			let resolved = false;
			loginPromise.then(() => {
				resolved = true;
			});
			await Promise.resolve();
			expect(resolved).toBe(false);

			// Now send correct state - this should resolve the promise
			await manager.handleCallback("auth-code", state, null);

			const result = await loginPromise;
			expect(result.token).toBe("test-access-token");
			expect(result.user.id).toBe(user.id);
		});
	});

	describe("refreshToken", () => {
		it("throws when no refresh token available", async () => {
			const { secretsManager, logger, loginCoordinator } = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			await expect(manager.refreshToken()).rejects.toThrow(
				"No refresh token available",
			);
		});

		it("refreshes token successfully", async () => {
			const {
				secretsManager,
				logger,
				loginCoordinator,
				mockAdapter,
				metadata,
				registration,
			} = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "old-access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + ONE_HOUR_MS,
					scope: "",
				},
			});
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				registration,
			);

			const newTokens = createMockTokenResponse({
				access_token: "new-access-token",
			});

			setupAxiosRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": metadata,
				"/oauth2/token": newTokens,
			});

			const result = await manager.refreshToken();

			expect(result.access_token).toBe("new-access-token");
		});
	});

	describe("login", () => {
		it("fetches metadata, registers client, exchanges token", async () => {
			vi.useRealTimers();

			const {
				secretsManager,
				logger,
				loginCoordinator,
				setupOAuthRoutes,
				user,
			} = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);

			const manager = OAuthSessionManager.create(null, container, EXTENSION_ID);

			const deployment = createTestDeployment();
			setupOAuthRoutes();

			let authUrl: string | undefined;
			vi.mocked(vscode.env.openExternal).mockImplementation((uri) => {
				authUrl = uri.toString();
				return Promise.resolve(true);
			});

			const progress = { report: vi.fn() };
			const cancellationToken: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
			};

			const loginPromise = manager.login(
				deployment,
				progress,
				cancellationToken,
			);

			await vi.waitFor(() => expect(authUrl).toBeDefined());

			expect(authUrl).toContain("oauth2/authorize");
			expect(authUrl).toContain("client_id=test-client-id");

			const urlParams = new URLSearchParams(new URL(authUrl!).search);
			const state = urlParams.get("state");
			expect(state).toBeTruthy();

			await manager.handleCallback("auth-code", state, null);

			const result = await loginPromise;

			expect(result.token).toBe("test-access-token");
			expect(result.user.id).toBe(user.id);

			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({ message: "fetching metadata..." }),
			);
			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({ message: "registering client..." }),
			);
			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({ message: "waiting for authorization..." }),
			);
			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({ message: "exchanging token..." }),
			);
			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({ message: "fetching user..." }),
			);
		});

		it("throws when cancelled via cancellation token", async () => {
			vi.useRealTimers();

			const {
				secretsManager,
				logger,
				loginCoordinator,
				mockAdapter,
				metadata,
				registration,
			} = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);

			const manager = OAuthSessionManager.create(null, container, EXTENSION_ID);

			const deployment = createTestDeployment();

			setupAxiosRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": metadata,
				"/oauth2/register": registration,
			});

			vi.mocked(vscode.env.openExternal).mockResolvedValue(true);

			const progress = { report: vi.fn() };

			let cancelCallback: ((e: unknown) => void) | undefined;
			const cancellationToken: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn((callback) => {
					cancelCallback = callback;
					return { dispose: vi.fn() };
				}),
			};

			const loginPromise = manager.login(
				deployment,
				progress,
				cancellationToken,
			);

			await vi.waitFor(() =>
				expect(vi.mocked(vscode.env.openExternal)).toHaveBeenCalled(),
			);

			if (cancelCallback) {
				cancelCallback({});
			}

			await expect(loginPromise).rejects.toThrow(
				"OAuth flow cancelled by user",
			);
		});

		it("rejects when OAuth flow times out", async () => {
			vi.useFakeTimers();

			const {
				secretsManager,
				logger,
				loginCoordinator,
				mockAdapter,
				metadata,
				registration,
			} = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);

			const manager = OAuthSessionManager.create(null, container, EXTENSION_ID);

			const deployment = createTestDeployment();

			setupAxiosRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": metadata,
				"/oauth2/register": registration,
			});

			vi.mocked(vscode.env.openExternal).mockResolvedValue(true);

			const progress = { report: vi.fn() };
			const cancellationToken: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
			};

			const loginPromise = manager.login(
				deployment,
				progress,
				cancellationToken,
			);

			// Attach rejection handler immediately to prevent unhandled rejection
			let rejectionError: Error | undefined;
			loginPromise.catch((err) => {
				rejectionError = err;
			});

			await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS + 1);

			expect(rejectionError).toBeDefined();
			expect(rejectionError?.message).toBe(
				"OAuth flow timed out after 5 minutes",
			);
		});
	});

	describe("getStoredTokens validation", () => {
		it("returns undefined when URL mismatches", async () => {
			const { secretsManager, logger, loginCoordinator } = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: "https://different-coder.example.com",
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + ONE_HOUR_MS,
					scope: "",
				},
			});

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(false);
		});
	});

	describe("setDeployment", () => {
		it("switches to new deployment", async () => {
			const { secretsManager, logger, loginCoordinator } = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);

			const manager = OAuthSessionManager.create(
				createTestDeployment(),
				container,
				EXTENSION_ID,
			);

			const newDeployment: Deployment = {
				url: "https://new-coder.example.com",
				safeHostname: "new-coder.example.com",
			};

			await manager.setDeployment(newDeployment);

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(false);
		});
	});

	describe("clearDeployment", () => {
		it("clears all deployment state", async () => {
			const { secretsManager, logger, loginCoordinator } = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			manager.clearDeployment();

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(false);
		});
	});

	describe("background refresh", () => {
		it("schedules refresh before token expiry", async () => {
			vi.useFakeTimers();

			const {
				secretsManager,
				logger,
				loginCoordinator,
				mockAdapter,
				metadata,
				registration,
			} = createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + ONE_HOUR_MS,
				},
			});
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				registration,
			);

			const newTokens = createMockTokenResponse({
				access_token: "refreshed-token",
			});

			setupAxiosRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": metadata,
				"/oauth2/token": newTokens,
			});

			OAuthSessionManager.create(deployment, container, EXTENSION_ID);

			// Advance to when refresh should trigger
			await vi.advanceTimersByTimeAsync(ONE_HOUR_MS - REFRESH_BUFFER_MS);

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("refreshed-token");
		});
	});

	describe("showReAuthenticationModal", () => {
		it("clears OAuth state and prompts for re-login", async () => {
			const { secretsManager, logger, loginCoordinator, registration } =
				createTestContext();
			const container = createMockServiceContainer(
				secretsManager,
				logger,
				loginCoordinator,
			);
			const deployment = createTestDeployment();

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + ONE_HOUR_MS,
				},
			});
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				registration,
			);

			const manager = OAuthSessionManager.create(
				deployment,
				container,
				EXTENSION_ID,
			);

			const error = new InvalidGrantError("Token expired");
			await manager.showReAuthenticationModal(error);

			// OAuth state is cleared by the method before prompting for re-login
			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.oauth).toBeUndefined();
			expect(auth?.token).toBe("");

			expect(loginCoordinator.ensureLoggedInWithDialog).toHaveBeenCalled();
		});
	});
});
