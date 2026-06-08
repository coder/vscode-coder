import axios, { type AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
	type AuthRequiredHandler,
	AuthInterceptor,
} from "@/api/authInterceptor";
import { SecretsManager } from "@/core/secretsManager";

import {
	createTestTelemetryService,
	enableLocalTelemetry,
	TestSink,
} from "../../mocks/telemetry";
import {
	createAxiosError,
	createMockLogger,
	createMockServiceContainer,
	InMemoryMemento,
	InMemorySecretStorage,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";
import {
	createMockTokenResponse,
	TEST_HOSTNAME,
	TEST_URL,
} from "../oauth/testUtils";

import type { CoderApi } from "@/api/coderApi";
import type { AuthRecoveryAction } from "@/instrumentation/auth";
import type { OAuthSessionManager } from "@/oauth/sessionManager";
import type { TelemetryService } from "@/telemetry/service";

/**
 * Creates a mock axios instance with controllable interceptors.
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
	let host: string | undefined = TEST_URL;
	let authConfigVersion = 0;
	return {
		getAxiosInstance: () => axiosInstance,
		setSessionToken: vi.fn((token: string) => {
			sessionToken = token;
		}),
		getSessionToken: () => sessionToken,
		getHost: () => host,
		setHost: (newHost: string | undefined) => {
			host = newHost;
		},
		hasAuthConfigChangedSince: (version: number | undefined) =>
			version !== undefined && version !== authConfigVersion,
		setAuthConfigVersion: (version: number) => {
			authConfigVersion = version;
		},
	} as unknown as CoderApi;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function createTestContext() {
	vi.resetAllMocks();
	enableLocalTelemetry();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);

	const axiosInstance = createMockAxiosInstance();
	const mockCoderApi = createMockCoderApi(axiosInstance);
	const mockOAuthManager = new MockOAuthSessionManager();

	// Default: not logged in with OAuth
	mockOAuthManager.isLoggedInWithOAuth.mockResolvedValue(false);

	/** Sets up OAuth tokens in storage and configures mock */
	const setupOAuthTokens = async () => {
		await secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: "access-token",
			oauth: {
				refresh_token: "refresh-token",
				expiry_timestamp: Date.now() + ONE_HOUR_MS,
				scope: "workspace:read",
			},
		});
		mockOAuthManager.isLoggedInWithOAuth.mockImplementation(
			async (hostname?: string) => {
				if (hostname && hostname !== TEST_HOSTNAME) {
					return false;
				}
				const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
				return auth?.oauth !== undefined;
			},
		);
	};

	/** Sets up session token only (no OAuth) */
	const setupSessionToken = async () => {
		await secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: "session-token",
		});
	};

	/** Sets up mTLS auth (no token) */
	const setupMTLSAuth = async () => {
		await secretsManager.setSessionAuth(TEST_HOSTNAME, {
			url: TEST_URL,
			token: "",
		});
	};

	/** Creates interceptor with optional callback */
	const createInterceptor = (
		onAuthRequired?: AuthRequiredHandler,
		telemetry?: TelemetryService,
	) =>
		new AuthInterceptor(
			mockCoderApi,
			mockOAuthManager as unknown as OAuthSessionManager,
			createMockServiceContainer({ telemetry, logger, secretsManager }),
			onAuthRequired,
		);

	return {
		secretsManager,
		logger,
		axiosInstance,
		mockCoderApi,
		mockOAuthManager: mockOAuthManager as unknown as OAuthSessionManager &
			MockOAuthSessionManager,
		setupOAuthTokens,
		setupSessionToken,
		setupMTLSAuth,
		createInterceptor,
	};
}

describe("AuthInterceptor", () => {
	describe("always attached", () => {
		it("attaches interceptor on creation", () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			createInterceptor();

			expect(axiosInstance.getInterceptorCount()).toBe(1);
		});

		it("detaches interceptor on dispose", () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			const interceptor = createInterceptor();
			expect(axiosInstance.getInterceptorCount()).toBe(1);

			interceptor.dispose();

			expect(axiosInstance.getInterceptorCount()).toBe(0);
		});
	});

	describe("401 handling with OAuth", () => {
		it("refreshes token and retries the request", async () => {
			const {
				mockCoderApi,
				mockOAuthManager,
				axiosInstance,
				setupOAuthTokens,
				createInterceptor,
			} = createTestContext();

			await setupOAuthTokens();

			const newTokens = createMockTokenResponse({
				access_token: "new-access-token",
			});
			mockOAuthManager.refreshToken.mockResolvedValue(newTokens);

			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);

			createInterceptor();

			const error = createAxiosError(401, "Unauthorized");
			const result = await axiosInstance.triggerResponseError(error);

			expect(mockCoderApi.getSessionToken()).toBe("new-access-token");
			expect(result).toEqual(retryResponse);
		});

		it("does not retry if already retried", async () => {
			const {
				mockOAuthManager,
				axiosInstance,
				setupOAuthTokens,
				createInterceptor,
			} = createTestContext();

			await setupOAuthTokens();
			createInterceptor();

			const error = createAxiosError(401, "Unauthorized", {
				_retryAttempted: true,
			});

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
		});

		it("falls through to callback if refresh fails", async () => {
			const {
				mockOAuthManager,
				axiosInstance,
				setupOAuthTokens,
				createInterceptor,
			} = createTestContext();

			await setupOAuthTokens();
			mockOAuthManager.refreshToken.mockRejectedValue(
				new Error("Refresh failed"),
			);

			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow(
				"Unauthorized",
			);
			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
		});
	});

	describe("401 handling with callback (non-OAuth)", () => {
		it("calls onAuthRequired callback on 401", async () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
		});

		it("retries request when callback returns true", async () => {
			const { secretsManager, axiosInstance, createInterceptor } =
				createTestContext();

			// Setup new token that will be available after re-auth
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "new-token-after-login",
			});

			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);

			const onAuthRequired = vi.fn().mockResolvedValue(true);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");
			const result = await axiosInstance.triggerResponseError(error);

			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
			expect(result).toEqual(retryResponse);
		});

		it("retries request with mTLS (no token)", async () => {
			const { axiosInstance, setupMTLSAuth, createInterceptor } =
				createTestContext();

			// Setup mTLS auth - callback will "re-authenticate" but there's no token
			await setupMTLSAuth();

			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);

			const onAuthRequired = vi.fn().mockResolvedValue(true);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");
			const result = await axiosInstance.triggerResponseError(error);

			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
			expect(result).toEqual(retryResponse);
		});

		it("rethrows when callback returns false", async () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow(
				"Unauthorized",
			);
		});

		it("rethrows when no callback provided", async () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			createInterceptor(); // No callback

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow(
				"Unauthorized",
			);
		});
	});

	describe("no-op when no deployment", () => {
		it("does not handle 401 when client has no host", async () => {
			const { mockCoderApi, axiosInstance, createInterceptor } =
				createTestContext();

			// Clear the host
			(mockCoderApi as { setHost: (h: string | undefined) => void }).setHost(
				undefined,
			);

			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(onAuthRequired).not.toHaveBeenCalled();
		});
	});

	describe("error passthrough", () => {
		it.each<{ name: string; error: Error }>([
			{
				name: "non-401 axios error",
				error: createAxiosError(500, "Server Error"),
			},
			{ name: "non-axios error", error: new Error("Network failure") },
		])("ignores $name", async ({ error }) => {
			const { mockOAuthManager, axiosInstance, createInterceptor } =
				createTestContext();

			const onAuthRequired = vi.fn();
			createInterceptor(onAuthRequired);

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
			expect(onAuthRequired).not.toHaveBeenCalled();
		});
	});

	describe("race condition safety", () => {
		it("silently retries when auth settings changed since the request started", async () => {
			const { mockCoderApi, axiosInstance, createInterceptor } =
				createTestContext();
			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);
			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized", {
				authConfigVersion: 0,
			});
			(
				mockCoderApi as unknown as {
					setAuthConfigVersion: (version: number) => void;
				}
			).setAuthConfigVersion(1);

			const result = await axiosInstance.triggerResponseError(error);

			expect(result).toBe(retryResponse);
			expect(axiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					_authConfigRetryAttempted: true,
				}),
			);
			expect(onAuthRequired).not.toHaveBeenCalled();
		});

		it("escalates to interactive after the silent auth-config retry already ran", async () => {
			const { mockCoderApi, axiosInstance, createInterceptor } =
				createTestContext();
			vi.spyOn(axiosInstance, "request");
			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);
			(
				mockCoderApi as unknown as {
					setAuthConfigVersion: (version: number) => void;
				}
			).setAuthConfigVersion(1);

			const error = createAxiosError(401, "Unauthorized", {
				authConfigVersion: 0,
				_authConfigRetryAttempted: true,
			});

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(axiosInstance.request).not.toHaveBeenCalled();
			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
		});

		it("still silent-retries when an OAuth-retry 401s under newly-changed settings", async () => {
			const { mockCoderApi, axiosInstance, createInterceptor } =
				createTestContext();
			const retryResponse = { data: "success", status: 200 };
			vi.spyOn(axiosInstance, "request").mockResolvedValue(retryResponse);
			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);
			(
				mockCoderApi as unknown as {
					setAuthConfigVersion: (version: number) => void;
				}
			).setAuthConfigVersion(1);

			const error = createAxiosError(401, "Unauthorized", {
				authConfigVersion: 0,
				_retryAttempted: true,
			});

			const result = await axiosInstance.triggerResponseError(error);
			expect(result).toBe(retryResponse);
			expect(axiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({ _authConfigRetryAttempted: true }),
			);
			expect(onAuthRequired).not.toHaveBeenCalled();
		});

		it("gives up once both silent and OAuth/interactive retries have run", async () => {
			const { mockCoderApi, axiosInstance, createInterceptor } =
				createTestContext();
			vi.spyOn(axiosInstance, "request");
			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);
			(
				mockCoderApi as unknown as {
					setAuthConfigVersion: (version: number) => void;
				}
			).setAuthConfigVersion(1);

			const error = createAxiosError(401, "Unauthorized", {
				authConfigVersion: 0,
				_retryAttempted: true,
				_authConfigRetryAttempted: true,
			});

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();
			expect(axiosInstance.request).not.toHaveBeenCalled();
			expect(onAuthRequired).not.toHaveBeenCalled();
		});

		it("skips OAuth refresh if hostname changed", async () => {
			const {
				mockOAuthManager,
				axiosInstance,
				setupOAuthTokens,
				createInterceptor,
			} = createTestContext();

			await setupOAuthTokens();

			// Make isLoggedInWithOAuth return false for different hostname
			mockOAuthManager.isLoggedInWithOAuth.mockImplementation(
				(hostname?: string) => {
					// Simulate hostname mismatch (deployment changed)
					if (hostname === TEST_HOSTNAME) {
						return Promise.resolve(false); // Deployment changed, not the current one
					}
					return Promise.resolve(false);
				},
			);

			const onAuthRequired = vi.fn().mockResolvedValue(false);
			createInterceptor(onAuthRequired);

			const error = createAxiosError(401, "Unauthorized");

			await expect(axiosInstance.triggerResponseError(error)).rejects.toThrow();

			// Should not have tried OAuth refresh
			expect(mockOAuthManager.refreshToken).not.toHaveBeenCalled();
			// Should have called callback instead
			expect(onAuthRequired).toHaveBeenCalledWith(TEST_HOSTNAME);
		});
	});

	describe("dispose", () => {
		it("cleans up interceptor", () => {
			const { axiosInstance, createInterceptor } = createTestContext();

			const interceptor = createInterceptor();
			expect(axiosInstance.getInterceptorCount()).toBe(1);

			interceptor.dispose();

			expect(axiosInstance.getInterceptorCount()).toBe(0);
		});
	});

	describe("telemetry", () => {
		interface RecoveryCase {
			name: string;
			arrange: (ctx: ReturnType<typeof createTestContext>) => Promise<void>;
			withCallback: boolean;
			callbackResult?: boolean;
			expectThrow: boolean;
			expected: {
				recovery: AuthRecoveryAction;
				refresh_attempted: "true" | "false";
				result: "success" | "error";
			};
		}

		it.each<RecoveryCase>([
			{
				name: "OAuth refresh succeeds: recovery=refresh_success",
				arrange: async (ctx) => {
					await ctx.setupOAuthTokens();
					ctx.mockOAuthManager.refreshToken.mockResolvedValue(
						createMockTokenResponse({ access_token: "new" }),
					);
					vi.spyOn(ctx.axiosInstance, "request").mockResolvedValue({
						status: 200,
					});
				},
				withCallback: false,
				expectThrow: false,
				expected: {
					recovery: "refresh_success",
					refresh_attempted: "true",
					result: "success",
				},
			},
			{
				name: "no OAuth + callback declines: recovery=login_required",
				arrange: () => Promise.resolve(),
				withCallback: true,
				callbackResult: false,
				expectThrow: true,
				expected: {
					recovery: "login_required",
					refresh_attempted: "false",
					result: "error",
				},
			},
			{
				name: "no OAuth + no callback: recovery=none",
				arrange: () => Promise.resolve(),
				withCallback: false,
				expectThrow: true,
				expected: {
					recovery: "none",
					refresh_attempted: "false",
					result: "error",
				},
			},
			{
				name: "OAuth refresh fails + callback declines: refresh_attempted=true, recovery=login_required",
				arrange: async (ctx) => {
					await ctx.setupOAuthTokens();
					ctx.mockOAuthManager.refreshToken.mockRejectedValue(
						new Error("refresh failed"),
					);
				},
				withCallback: true,
				callbackResult: false,
				expectThrow: true,
				expected: {
					recovery: "login_required",
					refresh_attempted: "true",
					result: "error",
				},
			},
		])(
			"$name",
			async ({
				arrange,
				withCallback,
				callbackResult,
				expectThrow,
				expected,
			}) => {
				const sink = new TestSink();
				const ctx = createTestContext();
				await arrange(ctx);
				const onAuthRequired = withCallback
					? vi.fn().mockResolvedValue(callbackResult)
					: undefined;
				ctx.createInterceptor(onAuthRequired, createTestTelemetryService(sink));

				const trigger = ctx.axiosInstance.triggerResponseError(
					createAxiosError(401, "Unauthorized"),
				);
				if (expectThrow) {
					await expect(trigger).rejects.toThrow();
				} else {
					await trigger;
				}

				expect(
					sink.expectOne("auth.unauthorized_intercepted").properties,
				).toMatchObject(expected);
			},
		);

		it("includes durationMs on the recovery span", async () => {
			const sink = new TestSink();
			const ctx = createTestContext();
			await ctx.setupOAuthTokens();
			ctx.mockOAuthManager.refreshToken.mockResolvedValue(
				createMockTokenResponse({ access_token: "new" }),
			);
			vi.spyOn(ctx.axiosInstance, "request").mockResolvedValue({
				status: 200,
			});
			ctx.createInterceptor(undefined, createTestTelemetryService(sink));

			await ctx.axiosInstance.triggerResponseError(
				createAxiosError(401, "Unauthorized"),
			);

			expect(
				sink.expectOne("auth.unauthorized_intercepted").measurements.durationMs,
			).toEqual(expect.any(Number));
		});

		it("emits a received log under the recovery span", async () => {
			const sink = new TestSink();
			const ctx = createTestContext();
			await ctx.setupOAuthTokens();
			ctx.mockOAuthManager.refreshToken.mockResolvedValue(
				createMockTokenResponse({ access_token: "new" }),
			);
			vi.spyOn(ctx.axiosInstance, "request").mockResolvedValue({
				status: 200,
			});
			ctx.createInterceptor(undefined, createTestTelemetryService(sink));

			await ctx.axiosInstance.triggerResponseError(
				createAxiosError(401, "Unauthorized"),
			);

			const received = sink.expectOne("auth.unauthorized_intercepted.received");
			const recovery = sink.expectOne("auth.unauthorized_intercepted");
			expect(received.traceId).toBe(recovery.traceId);
			expect(received.parentEventId).toBe(recovery.eventId);
			expect(received.measurements.durationMs).toBeUndefined();
			expect(received.properties.result).toBeUndefined();
		});
	});
});
