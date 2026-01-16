import {
	type GenericAbortSignal,
	type InternalAxiosRequestConfig,
	type AxiosRequestConfig,
} from "axios";
import { describe, expect, it, vi } from "vitest";

import { type SecretsManager, type SessionAuth } from "@/core/secretsManager";
import { OAuthError } from "@/oauth/errors";
import { OAuthSessionManager } from "@/oauth/sessionManager";

import {
	type createMockLogger,
	setupAxiosMockRoutes,
} from "../../mocks/testHelpers";

import {
	createBaseTestContext,
	createMockClientRegistration,
	createMockOAuthMetadata,
	createMockTokenResponse,
	createTestDeployment,
	TEST_HOSTNAME,
	TEST_URL,
} from "./testUtils";

import type { ServiceContainer } from "@/core/container";
import type { Deployment } from "@/deployment/types";
import type { LoginCoordinator } from "@/login/loginCoordinator";

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");
	const mockAdapter = vi.fn();
	return {
		...actual,
		default: {
			...actual.default,
			create: vi.fn((config?: AxiosRequestConfig) =>
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

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Tokens refresh 5 minutes before expiry
const ONE_HOUR_MS = 60 * 60 * 1000;

function createMockLoginCoordinator(): LoginCoordinator {
	return {
		ensureLoggedIn: vi.fn(),
		ensureLoggedInWithDialog: vi.fn(),
	} as unknown as LoginCoordinator;
}

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

function createTestContext(deployment: Deployment = createTestDeployment()) {
	vi.resetAllMocks();

	const base = createBaseTestContext();
	const loginCoordinator = createMockLoginCoordinator();
	const container = createMockServiceContainer(
		base.secretsManager,
		base.logger,
		loginCoordinator,
	);
	const manager = OAuthSessionManager.create(deployment, container);

	/** Sets up OAuth session auth */
	const setupOAuthSession = async (
		overrides: {
			token?: string;
			refreshToken?: string;
			expiryMs?: number;
			scope?: string;
		} = {},
	) => {
		await base.secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: overrides.token ?? "access-token",
			oauth: {
				refresh_token: overrides.refreshToken ?? "refresh-token",
				expiry_timestamp: Date.now() + (overrides.expiryMs ?? ONE_HOUR_MS),
				scope: overrides.scope ?? "",
			},
		});
	};

	/** Creates a new manager (for tests that need manager created after OAuth setup) */
	const createManager = (d: Deployment = deployment) =>
		OAuthSessionManager.create(d, container);

	return {
		...base,
		loginCoordinator,
		manager,
		setupOAuthSession,
		createManager,
	};
}

describe("OAuthSessionManager", () => {
	describe("isLoggedInWithOAuth", () => {
		interface IsLoggedInTestCase {
			name: string;
			auth: SessionAuth | null;
			expected: boolean;
		}

		it.each<IsLoggedInTestCase>([
			{
				name: "returns true when OAuth tokens exist",
				auth: {
					url: TEST_URL,
					token: "access-token",
					oauth: {
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
			const { secretsManager, manager } = createTestContext();

			if (auth) {
				await secretsManager.setSessionAuth(TEST_HOSTNAME, auth);
			}

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(expected);
		});
	});

	describe("refreshToken", () => {
		it("throws when no refresh token available", async () => {
			const { manager } = createTestContext();

			await expect(manager.refreshToken()).rejects.toThrow(
				"No refresh token available",
			);
		});

		it("refreshes token successfully", async () => {
			const { secretsManager, mockAdapter, manager, setupOAuthSession } =
				createTestContext();

			await setupOAuthSession({ token: "old-token" });
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration(),
			);

			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/token": createMockTokenResponse({
					access_token: "refreshed-token",
				}),
			});

			const result = await manager.refreshToken();
			expect(result.access_token).toBe("refreshed-token");
		});
	});

	describe("getStoredTokens validation", () => {
		it("returns undefined when URL mismatches", async () => {
			const { secretsManager, manager } = createTestContext();

			// Manually set auth with different URL (can't use helper)
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: "https://different-coder.example.com",
				token: "access-token",
				oauth: {
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
			const { manager } = createTestContext();

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
			const { manager } = createTestContext();

			manager.clearDeployment();

			const result = await manager.isLoggedInWithOAuth();
			expect(result).toBe(false);
		});
	});

	describe("background refresh", () => {
		it("schedules refresh before token expiry", async () => {
			vi.useFakeTimers();

			const { secretsManager, mockAdapter, setupOAuthSession, createManager } =
				createTestContext();

			await setupOAuthSession({ token: "original-token" });
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration(),
			);

			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/token": createMockTokenResponse({
					access_token: "background-refreshed-token",
				}),
			});

			// Create manager AFTER OAuth session is set up so it schedules refresh
			createManager();

			// Advance to when refresh should trigger
			await vi.advanceTimersByTimeAsync(ONE_HOUR_MS - REFRESH_BUFFER_MS);

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("background-refreshed-token");
		});
	});

	describe("showReAuthenticationModal", () => {
		it("clears OAuth state and prompts for re-login", async () => {
			const { secretsManager, loginCoordinator, manager, setupOAuthSession } =
				createTestContext();

			await setupOAuthSession();
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration(),
			);

			await manager.showReAuthenticationModal(
				new OAuthError("invalid_grant", "Token expired"),
			);

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.oauth).toBeUndefined();
			expect(auth?.token).toBe("");
			expect(loginCoordinator.ensureLoggedInWithDialog).toHaveBeenCalled();
		});
	});

	describe("concurrent refresh", () => {
		it("deduplicates concurrent calls", async () => {
			const { secretsManager, mockAdapter, manager, setupOAuthSession } =
				createTestContext();

			await setupOAuthSession();
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration(),
			);

			let callCount = 0;
			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
				"/oauth2/token": () => {
					callCount++;
					return createMockTokenResponse({
						access_token: `token-${callCount}`,
					});
				},
			});

			const results = await Promise.all([
				manager.refreshToken(),
				manager.refreshToken(),
				manager.refreshToken(),
			]);

			expect(callCount).toBe(1);
			expect(results[0]).toEqual(results[1]);
			expect(results[1]).toEqual(results[2]);
		});
	});

	describe("refresh abortion", () => {
		it.each<{ name: string; abort: (m: OAuthSessionManager) => void }>([
			{
				name: "setDeployment",
				abort: (m) => {
					void m.setDeployment({
						url: "https://new.example.com",
						safeHostname: "new.example.com",
					});
				},
			},
			{ name: "clearDeployment", abort: (m) => m.clearDeployment() },
			{ name: "dispose", abort: (m) => m.dispose() },
		])("$name aborts in-flight refresh", async ({ abort }) => {
			const { secretsManager, mockAdapter, manager, setupOAuthSession } =
				createTestContext();

			await setupOAuthSession();
			await secretsManager.setOAuthClientRegistration(
				TEST_HOSTNAME,
				createMockClientRegistration(),
			);

			let abortSignal: GenericAbortSignal | undefined;
			const tokenEndpointCalled = new Promise<void>((resolve) => {
				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server":
						createMockOAuthMetadata(TEST_URL),
					"/oauth2/token": (config: InternalAxiosRequestConfig) => {
						abortSignal = config.signal;
						resolve();
						return new Promise((_, reject) => {
							(config.signal as AbortSignal)?.addEventListener("abort", () =>
								reject(new Error("canceled")),
							);
						});
					},
				});
			});

			const refreshPromise = manager.refreshToken();
			await tokenEndpointCalled;

			abort(manager);

			expect(abortSignal?.aborted).toBe(true);
			await expect(refreshPromise).rejects.toThrow("canceled");
		});

		it.each<{ name: string; method: (m: OAuthSessionManager) => void }>([
			{ name: "clearDeployment", method: (m) => m.clearDeployment() },
			{ name: "dispose", method: (m) => m.dispose() },
		])("$name can be called multiple times safely", async ({ method }) => {
			const { manager, setupOAuthSession } = createTestContext();
			await setupOAuthSession();

			expect(() => {
				method(manager);
				method(manager);
				method(manager);
			}).not.toThrow();
		});
	});
});
