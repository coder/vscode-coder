import axios, { type AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { SecretsManager } from "@/core/secretsManager";
import { OAuthInterceptor } from "@/oauth/oauthInterceptor";

import {
	createAxiosError,
	createMockLogger,
	createMockTokenResponse,
	InMemoryMemento,
	InMemorySecretStorage,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { OAuthSessionManager } from "@/oauth/sessionManager";

const TEST_HOSTNAME = "coder.example.com";
const TEST_URL = "https://coder.example.com";

/**
 * Creates a mock axios instance with controllable interceptors.
 * Simplified to track count and last handler only.
 */
function createMockAxiosInstance(): AxiosInstance & {
	triggerResponseError: (error: unknown) => Promise<unknown>;
	getInterceptorCount: () => number;
} {
	const instance = axios.create();
	let interceptorCount = 0;
	let lastRejectedHandler: ((error: unknown) => unknown) | null = null;

	vi.spyOn(instance.interceptors.response, "use").mockImplementation(
		(_onFulfilled, onRejected) => {
			interceptorCount++;
			lastRejectedHandler = onRejected ?? ((e) => Promise.reject(e));
			return interceptorCount;
		},
	);

	vi.spyOn(instance.interceptors.response, "eject").mockImplementation(() => {
		interceptorCount = Math.max(0, interceptorCount - 1);
		if (interceptorCount === 0) {
			lastRejectedHandler = null;
		}
	});

	return Object.assign(instance, {
		triggerResponseError: (error: unknown): Promise<unknown> => {
			if (!lastRejectedHandler) {
				return Promise.reject(error);
			}
			return Promise.resolve(lastRejectedHandler(error));
		},
		getInterceptorCount: () => interceptorCount,
	});
}

function createMockCoderApi(axiosInstance: AxiosInstance): CoderApi {
	let sessionToken: string | undefined;
	return {
		getAxiosInstance: () => axiosInstance,
		setSessionToken: vi.fn((token: string) => {
			sessionToken = token;
		}),
		getSessionToken: () => sessionToken,
	} as unknown as CoderApi;
}

function createTestContext() {
	vi.resetAllMocks();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);

	const axiosInstance = createMockAxiosInstance();
	const mockCoderApi = createMockCoderApi(axiosInstance);
	const mockOAuthManager = new MockOAuthSessionManager();

	// Make isLoggedInWithOAuth check actual storage instead of returning a fixed value
	vi.spyOn(mockOAuthManager, "isLoggedInWithOAuth").mockImplementation(
		async () => {
			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			return auth?.oauth !== undefined;
		},
	);

	return {
		secretsManager,
		logger,
		axiosInstance,
		mockCoderApi,
		mockOAuthManager: mockOAuthManager as unknown as OAuthSessionManager &
			MockOAuthSessionManager,
	};
}

describe("OAuthInterceptor", () => {
	describe("attach/detach based on token state", () => {
		it("attaches when OAuth tokens stored", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			// Store OAuth tokens before creating interceptor
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			expect(axiosInstance.getInterceptorCount()).toBe(1);
		});

		it("does not attach when no OAuth tokens", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			// Store session token without OAuth
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "session-token",
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			expect(axiosInstance.getInterceptorCount()).toBe(0);
		});

		it("detaches when OAuth tokens cleared", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			// Start with OAuth tokens
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			expect(axiosInstance.getInterceptorCount()).toBe(1);

			// Clear OAuth by setting session token only
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "session-token",
			});

			// Wait for async handler to complete
			await vi.waitFor(() => {
				expect(axiosInstance.getInterceptorCount()).toBe(0);
			});
		});

		it("attaches when OAuth tokens added", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			// Start without OAuth
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "session-token",
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			expect(axiosInstance.getInterceptorCount()).toBe(0);

			// Add OAuth tokens
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			await vi.waitFor(() => {
				expect(axiosInstance.getInterceptorCount()).toBe(1);
			});
		});
	});

	describe("401 handling", () => {
		it("refreshes token and retries request", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			// Setup OAuth tokens
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			const newTokens = createMockTokenResponse({
				access_token: "new-access-token",
			});
			mockOAuthManager.refreshToken.mockResolvedValue(newTokens);

			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			const error = createAxiosError(401, "Unauthorized");
			const result = await axiosInstance.triggerResponseError(error);

			expect(mockCoderApi.getSessionToken()).toBe("new-access-token");
			expect(result).toEqual(retryResponse);
		});

		it("does not retry if already retried", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			const error = createAxiosError(401, "Unauthorized", {
				_oauthRetryAttempted: true,
			});

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
		});

		it("rethrows original error if refresh fails", async () => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			mockOAuthManager.refreshToken.mockRejectedValue(
				new Error("Refresh failed"),
			);

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow(
				"Unauthorized",
			);
		});

		it.each<{ name: string; error: Error }>([
			{
				name: "non-401 axios error",
				error: createAxiosError(500, "Server Error"),
			},
			{ name: "non-axios error", error: new Error("Network failure") },
		])("ignores $name", async ({ error }) => {
			const {
				secretsManager,
				logger,
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
			} = createTestContext();

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3600000,
				},
			});

			await OAuthInterceptor.create(
				mockCoderApi,
				logger,
				mockOAuthManager,
				secretsManager,
				TEST_HOSTNAME,
			);

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
		});
	});
});
