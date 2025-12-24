import axios, { type AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { SecretsManager } from "@/core/secretsManager";
import { OAuthInterceptor } from "@/oauth/axiosInterceptor";

import {
	createAxiosError,
	createMockLogger,
	InMemoryMemento,
	InMemorySecretStorage,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";

import { createMockTokenResponse, TEST_HOSTNAME, TEST_URL } from "./testUtils";

import type { CoderApi } from "@/api/coderApi";
import type { OAuthSessionManager } from "@/oauth/sessionManager";

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
			lastRejectedHandler =
				onRejected ??
				((e): never => {
					throw e;
				});
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
				return Promise.reject(new Error(String(error)));
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

const ONE_HOUR_MS = 60 * 60 * 1000;

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
	mockOAuthManager.isLoggedInWithOAuth.mockImplementation(async () => {
		const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
		return auth?.oauth !== undefined;
	});

	/** Sets up OAuth tokens and creates interceptor */
	const setupOAuthInterceptor = async () => {
		await secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: "access-token",
			oauth: {
				token_type: "Bearer",
				refresh_token: "refresh-token",
				expiry_timestamp: Date.now() + ONE_HOUR_MS,
			},
		});
		return OAuthInterceptor.create(
			mockCoderApi,
			logger,
			mockOAuthManager as unknown as OAuthSessionManager,
			secretsManager,
			TEST_HOSTNAME,
		);
	};

	/** Sets up session token only (no OAuth) */
	const setupSessionToken = async () => {
		await secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: "session-token",
		});
	};

	/** Creates interceptor without any pre-existing auth */
	const createInterceptor = () =>
		OAuthInterceptor.create(
			mockCoderApi,
			logger,
			mockOAuthManager as unknown as OAuthSessionManager,
			secretsManager,
			TEST_HOSTNAME,
		);

	return {
		secretsManager,
		logger,
		axiosInstance,
		mockCoderApi,
		mockOAuthManager: mockOAuthManager as unknown as OAuthSessionManager &
			MockOAuthSessionManager,
		setupOAuthInterceptor,
		setupSessionToken,
		createInterceptor,
	};
}

describe("OAuthInterceptor", () => {
	describe("attach/detach based on token state", () => {
		it("attaches when OAuth tokens stored", async () => {
			const { axiosInstance, setupOAuthInterceptor } = createTestContext();

			await setupOAuthInterceptor();

			expect(axiosInstance.getInterceptorCount()).toBe(1);
		});

		it("does not attach when no OAuth tokens", async () => {
			const { axiosInstance, setupSessionToken, createInterceptor } =
				createTestContext();

			await setupSessionToken();
			await createInterceptor();

			expect(axiosInstance.getInterceptorCount()).toBe(0);
		});

		it("detaches when OAuth tokens cleared", async () => {
			const { axiosInstance, setupOAuthInterceptor, setupSessionToken } =
				createTestContext();

			await setupOAuthInterceptor();
			expect(axiosInstance.getInterceptorCount()).toBe(1);

			await setupSessionToken();
			await vi.waitFor(() => {
				expect(axiosInstance.getInterceptorCount()).toBe(0);
			});
		});

		it("attaches when OAuth tokens added", async () => {
			const {
				secretsManager,
				axiosInstance,
				setupSessionToken,
				createInterceptor,
			} = createTestContext();

			await setupSessionToken();
			await createInterceptor();
			expect(axiosInstance.getInterceptorCount()).toBe(0);

			// Add OAuth tokens
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "access-token",
				oauth: {
					token_type: "Bearer",
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + ONE_HOUR_MS,
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
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
				setupOAuthInterceptor,
			} = createTestContext();

			const newTokens = createMockTokenResponse({
				access_token: "new-access-token",
			});
			mockOAuthManager.refreshToken.mockResolvedValue(newTokens);

			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);

			await setupOAuthInterceptor();

			const error = createAxiosError(401, "Unauthorized");
			const result = await axiosInstance.triggerResponseError(error);

			expect(mockCoderApi.getSessionToken()).toBe("new-access-token");
			expect(result).toEqual(retryResponse);
		});

		it("does not retry if already retried", async () => {
			const { mockOAuthManager, axiosInstance, setupOAuthInterceptor } =
				createTestContext();

			await setupOAuthInterceptor();

			const error = createAxiosError(401, "Unauthorized", {
				_oauthRetryAttempted: true,
			});

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
		});

		it("rethrows original error if refresh fails", async () => {
			const { mockOAuthManager, axiosInstance, setupOAuthInterceptor } =
				createTestContext();

			mockOAuthManager.refreshToken.mockRejectedValue(
				new Error("Refresh failed"),
			);

			await setupOAuthInterceptor();

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
			const { mockOAuthManager, axiosInstance, setupOAuthInterceptor } =
				createTestContext();

			await setupOAuthInterceptor();

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
		});
	});
});
