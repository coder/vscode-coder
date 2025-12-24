import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { getHeaders } from "@/headers";
import { OAuthAuthorizer } from "@/oauth/authorizer";

import {
	MockCancellationToken,
	MockProgress,
	setupAxiosMockRoutes,
} from "../../mocks/testHelpers";

import {
	createMockTokenResponse,
	createBaseTestContext,
	createMockClientRegistration,
	createMockOAuthMetadata,
	createTestDeployment,
	TEST_HOSTNAME,
	TEST_URL,
} from "./testUtils";

import type { CreateAxiosDefaults } from "axios";

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");
	const mockAdapter = vi.fn();
	return {
		...actual,
		default: {
			...actual.default,
			create: vi.fn((config?: CreateAxiosDefaults) =>
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

vi.mock("@/api/streamingFetchAdapter", () => ({
	createStreamingFetchAdapter: vi.fn(() => fetch),
}));

const EXTENSION_ID = "coder.coder-remote";

function createTestContext() {
	vi.resetAllMocks();
	vi.mocked(getHeaders).mockResolvedValue({});

	const base = createBaseTestContext();
	const authorizer = new OAuthAuthorizer(
		base.secretsManager,
		base.logger,
		EXTENSION_ID,
	);

	/** Starts login flow and waits for browser to open. Returns promise and state for completing flow. */
	const startLogin = async (options?: {
		progress?: MockProgress;
		token?: MockCancellationToken;
	}) => {
		const progress = options?.progress ?? new MockProgress();
		const token = options?.token ?? new MockCancellationToken();
		const loginPromise = authorizer.login(
			createTestDeployment(),
			progress,
			token,
		);
		const { state, authUrl } = await waitForBrowserToOpen();
		return { loginPromise, state, authUrl, progress, token };
	};

	/** Completes login by sending successful OAuth callback */
	const completeLogin = async (state: string) => {
		await base.secretsManager.setOAuthCallback({
			state,
			code: "code",
			error: null,
		});
	};

	return { ...base, authorizer, startLogin, completeLogin };
}

/**
 * Wait for openExternal to be called and return the auth URL and state.
 */
async function waitForBrowserToOpen(): Promise<{
	authUrl: URL;
	state: string;
}> {
	await vi.waitFor(() => {
		expect(vscode.env.openExternal).toHaveBeenCalled();
	});
	const openExternalCall = vi.mocked(vscode.env.openExternal).mock.calls[0][0];
	const authUrl = new URL(openExternalCall.toString());
	return { authUrl, state: authUrl.searchParams.get("state")! };
}

describe("OAuthAuthorizer", () => {
	describe("login flow", () => {
		it("completes full OAuth login flow successfully", async () => {
			const { mockAdapter, secretsManager, authorizer } = createTestContext();

			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/register": createMockClientRegistration({
					client_id: "registered-client-id",
				}),
				"/oauth2/token": createMockTokenResponse({
					access_token: "oauth-access-token",
				}),
				"/api/v2/users/me": { username: "oauth-user" },
			});

			const deployment = createTestDeployment();
			const progress = new MockProgress();
			const cancellationToken = new MockCancellationToken();

			const loginPromise = authorizer.login(
				deployment,
				progress,
				cancellationToken,
			);

			const { state } = await waitForBrowserToOpen();

			// Set the callback with the correct state (simulate user clicking authorize)
			await secretsManager.setOAuthCallback({
				state,
				code: "auth-code-123",
				error: null,
			});

			const result = await loginPromise;

			expect(result.tokenResponse.access_token).toBe("oauth-access-token");
			expect(result.user.username).toBe("oauth-user");

			// Verify client registration was stored
			const storedRegistration =
				await secretsManager.getOAuthClientRegistration(TEST_HOSTNAME);
			expect(storedRegistration?.client_id).toBe("registered-client-id");
		});

		it("uses existing client registration when redirect URI matches", async () => {
			const { mockAdapter, secretsManager, authorizer } = createTestContext();

			// Pre-store a client registration with matching redirect URI
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration({
					client_id: "existing-client-id",
					redirect_uris: [`vscode://${EXTENSION_ID}/oauth/callback`],
				}),
			);

			// Registration endpoint should throw if called (existing registration should be reused)
			setupAxiosMockRoutes(mockAdapter, {
				"/oauth2/register": new Error("Should not re-register"),
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/token": createMockTokenResponse(),
				"/api/v2/users/me": { username: "test-user" },
			});

			const loginPromise = authorizer.login(
				createTestDeployment(),
				new MockProgress(),
				new MockCancellationToken(),
			);

			const { authUrl, state } = await waitForBrowserToOpen();
			expect(authUrl.searchParams.get("client_id")).toBe("existing-client-id");

			await secretsManager.setOAuthCallback({
				state,
				code: "code",
				error: null,
			});
			await loginPromise;
		});

		it("re-registers client when redirect URI has changed", async () => {
			const { mockAdapter, secretsManager, authorizer } = createTestContext();

			// Pre-store a client registration with different redirect URI
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration({
					client_id: "old-client-id",
					redirect_uris: ["vscode://different-extension/oauth/callback"],
				}),
			);

			// Server will return new registration
			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/register": createMockClientRegistration({
					client_id: "new-client-id",
				}),
				"/oauth2/token": createMockTokenResponse(),
				"/api/v2/users/me": { username: "test-user" },
			});

			const loginPromise = authorizer.login(
				createTestDeployment(),
				new MockProgress(),
				new MockCancellationToken(),
			);

			const { authUrl, state } = await waitForBrowserToOpen();
			expect(authUrl.searchParams.get("client_id")).toBe("new-client-id");

			await secretsManager.setOAuthCallback({
				state,
				code: "code",
				error: null,
			});
			await loginPromise;

			const stored =
				await secretsManager.getOAuthClientRegistration(TEST_HOSTNAME);
			expect(stored?.client_id).toBe("new-client-id");
		});

		it("reports progress during login flow", async () => {
			const { setupOAuthRoutes, startLogin, completeLogin } =
				createTestContext();
			setupOAuthRoutes();

			const progress = new MockProgress();
			const { loginPromise, state } = await startLogin({ progress });
			await completeLogin(state);
			await loginPromise;

			const messages = progress.getReports().map((r) => r.message);
			expect(messages).toEqual([
				"fetching metadata...",
				"registering client...",
				"waiting for authorization...",
				"exchanging token...",
				"fetching user...",
			]);
		});
	});

	describe("callback handling", () => {
		it("ignores callback with wrong state", async () => {
			const { secretsManager, setupOAuthRoutes, startLogin, completeLogin } =
				createTestContext();
			setupOAuthRoutes();

			const { loginPromise, state } = await startLogin();

			// Send callback with wrong state - should be ignored
			await secretsManager.setOAuthCallback({
				state: "wrong-state",
				code: "code",
				error: null,
			});

			// Login should still be waiting
			const raceResult = await Promise.race([
				loginPromise.then(() => "completed"),
				new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
			]);
			expect(raceResult).toBe("timeout");

			// Now send correct callback
			await completeLogin(state);
			const result = await loginPromise;
			expect(result.tokenResponse.access_token).toBeDefined();
		});

		it("rejects on OAuth error callback", async () => {
			const { secretsManager, setupOAuthRoutes, startLogin } =
				createTestContext();
			setupOAuthRoutes();

			const { loginPromise, state } = await startLogin();
			await secretsManager.setOAuthCallback({
				state,
				code: null,
				error: "access_denied",
			});

			await expect(loginPromise).rejects.toThrow("OAuth error: access_denied");
		});

		it("rejects when no code is received", async () => {
			const { secretsManager, setupOAuthRoutes, startLogin } =
				createTestContext();
			setupOAuthRoutes();

			const { loginPromise, state } = await startLogin();
			await secretsManager.setOAuthCallback({ state, code: null, error: null });

			await expect(loginPromise).rejects.toThrow(
				"No authorization code received",
			);
		});
	});

	describe("cancellation", () => {
		it("rejects when cancelled before callback", async () => {
			const { setupOAuthRoutes, startLogin } = createTestContext();
			setupOAuthRoutes();

			const { loginPromise, token } = await startLogin();
			token.cancel();

			await expect(loginPromise).rejects.toThrow(
				"OAuth flow cancelled by user",
			);
		});

		it("rejects immediately when already cancelled", async () => {
			const { authorizer, setupOAuthRoutes } = createTestContext();
			setupOAuthRoutes();

			// Can't use startLogin() here because login rejects before browser opens
			await expect(
				authorizer.login(
					createTestDeployment(),
					new MockProgress(),
					new MockCancellationToken(true),
				),
			).rejects.toThrow("OAuth login cancelled by user");
		});
	});

	describe("dispose", () => {
		it("rejects pending auth when disposed", async () => {
			const { authorizer, setupOAuthRoutes, startLogin } = createTestContext();
			setupOAuthRoutes();

			const { loginPromise } = await startLogin();
			authorizer.dispose();

			await expect(loginPromise).rejects.toThrow("OAuthAuthorizer disposed");
		});

		it("does nothing when disposed without pending auth", () => {
			const { authorizer } = createTestContext();
			expect(() => authorizer.dispose()).not.toThrow();
		});
	});

	describe("error handling", () => {
		it("throws when server does not support dynamic client registration", async () => {
			const { mockAdapter, authorizer } = createTestContext();

			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
					TEST_URL,
					{ registration_endpoint: undefined },
				),
			});

			await expect(
				authorizer.login(
					createTestDeployment(),
					new MockProgress(),
					new MockCancellationToken(),
				),
			).rejects.toThrow("Server does not support dynamic client registration");
		});
	});
});
