import axios, { type CreateAxiosDefaults } from "axios";
import { describe, expect, it, vi, type Mock } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { getHeaders } from "@/headers";
import { AuthTelemetry } from "@/instrumentation/auth";
import { LoginCoordinator } from "@/login/loginCoordinator";
import { OAuthCallback } from "@/oauth/oauthCallback";
import { maybeAskAuthMethod, maybeAskUrl } from "@/promptUtils";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	createAxiosError,
	createMockCliCredentialManager,
	createMockLogger,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
	MockProgressReporter,
	MockUserInteraction,
} from "../../mocks/testHelpers";

import type { TelemetryService } from "@/telemetry/service";

// Hoisted mock adapter implementation
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
			create: vi.fn((config: CreateAxiosDefaults) =>
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

vi.mock("@/promptUtils", () => ({
	maybeAskAuthMethod: vi.fn().mockResolvedValue("legacy"),
	maybeAskUrl: vi.fn(),
}));

// Mock CoderApi to control getAuthenticatedUser behavior
const mockGetAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock("@/api/coderApi", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/api/coderApi")>();
	return {
		...original,
		CoderApi: {
			...original.CoderApi,
			create: vi.fn(() => ({
				getAxiosInstance: () => ({
					defaults: { baseURL: "https://coder.example.com" },
				}),
				setSessionToken: vi.fn(),
				getAuthenticatedUser: mockGetAuthenticatedUser,
				dispose: vi.fn(),
			})),
		},
	};
});

// Type for axios with our mock adapter
type MockedAxios = typeof axios & {
	__mockAdapter: Mock<(config: Record<string, unknown>) => Promise<unknown>>;
};

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

/**
 * Creates a fresh test context with all dependencies.
 */
function createTestContext(telemetry?: TelemetryService) {
	vi.resetAllMocks();

	const mockAdapter = (axios as MockedAxios).__mockAdapter;
	mockAdapter.mockImplementation(mockAxiosAdapterImpl);
	vi.mocked(getHeaders).mockResolvedValue({});
	vi.mocked(maybeAskAuthMethod).mockResolvedValue("legacy");

	const mockConfig = new MockConfigurationProvider();
	// MockUserInteraction sets up vscode.window dialogs and input boxes
	const userInteraction = new MockUserInteraction();
	// MockProgressReporter sets up vscode.window.withProgress to execute callbacks
	new MockProgressReporter();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);
	const oauthCallback = new OAuthCallback(secretStorage, logger);
	const mementoManager = new MementoManager(memento);

	const mockCredentialManager = createMockCliCredentialManager();
	const authTelemetry = new AuthTelemetry(
		telemetry ?? createTestTelemetryService(),
	);
	const coordinator = new LoginCoordinator(
		secretsManager,
		mementoManager,
		logger,
		mockCredentialManager,
		authTelemetry,
		oauthCallback,
		"coder.coder-remote",
	);

	const mockSuccessfulAuth = (user = createMockUser()) => {
		// Configure both the axios adapter (for tests that bypass CoderApi mock)
		// and mockGetAuthenticatedUser (for tests that use the CoderApi mock)
		mockAdapter.mockResolvedValue({
			data: user,
			status: 200,
			statusText: "OK",
			headers: {},
			config: {},
		});
		mockGetAuthenticatedUser.mockResolvedValue(user);
		return user;
	};

	const mockAuthFailure = (message = "Unauthorized") => {
		mockAdapter.mockRejectedValue(createAxiosError(401, message));
		mockGetAuthenticatedUser.mockRejectedValue(createAxiosError(401, message));
	};

	return {
		mockAdapter,
		mockGetAuthenticatedUser,
		mockConfig,
		userInteraction,
		logger,
		secretsManager,
		oauthCallback,
		mementoManager,
		mockCredentialManager,
		coordinator,
		mockSuccessfulAuth,
		mockAuthFailure,
	};
}

describe("LoginCoordinator", () => {
	describe("token authentication", () => {
		it("authenticates with stored token on success", async () => {
			const { secretsManager, coordinator, mockSuccessfulAuth } =
				createTestContext();
			const user = mockSuccessfulAuth();

			// Pre-store a token
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({
				success: true,
				method: "stored_token",
				user,
				token: "stored-token",
			});

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("stored-token");
		});

		it("authenticates with CLI credential token on success", async () => {
			const {
				mockCredentialManager,
				secretsManager,
				coordinator,
				mockSuccessfulAuth,
			} = createTestContext();
			const user = mockSuccessfulAuth();
			vi.mocked(mockCredentialManager.readToken).mockResolvedValueOnce(
				"cli-credential-token",
			);

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({
				success: true,
				method: "cli_token",
				user,
				token: "cli-credential-token",
			});
			expect(vscode.window.showInputBox).not.toHaveBeenCalled();

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("cli-credential-token");
		});

		it("prompts for token when no stored auth exists", async () => {
			const {
				userInteraction,
				secretsManager,
				coordinator,
				mockSuccessfulAuth,
			} = createTestContext();
			const user = mockSuccessfulAuth();

			// User enters a new token in the input box
			vi.mocked(maybeAskAuthMethod).mockResolvedValue("legacy");
			userInteraction.setInputBoxValue("new-token");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({
				success: true,
				method: "cli_token",
				user,
				token: "new-token",
			});

			// Verify new token was persisted
			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("new-token");
		});

		it("returns success false when user cancels input", async () => {
			const { userInteraction, coordinator, mockAuthFailure } =
				createTestContext();
			mockAuthFailure();
			userInteraction.setInputBoxValue(undefined);

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result.success).toBe(false);
		});
	});

	describe("same-window guard", () => {
		it("prevents duplicate login calls for same hostname", async () => {
			const { userInteraction, coordinator, mockSuccessfulAuth } =
				createTestContext();
			mockSuccessfulAuth();

			// User enters a token in the input box
			vi.mocked(maybeAskAuthMethod).mockResolvedValue("legacy");
			userInteraction.setInputBoxValue("new-token");

			// Start first login
			const login1 = coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			// Start second login immediately (same hostname)
			const login2 = coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			const [result1, result2] = await Promise.all([login1, login2]);
			expect(result1).toMatchObject({
				success: true,
				method: "cli_token",
				token: "new-token",
			});
			expect(result2).toMatchObject({
				success: true,
				method: "stored_token",
				token: "new-token",
			});

			// Input box should only be shown once (guard prevents duplicate prompts)
			expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
		});
	});

	describe("mTLS authentication", () => {
		it("succeeds without prompt and returns token=''", async () => {
			const { mockConfig, secretsManager, coordinator, mockSuccessfulAuth } =
				createTestContext();
			// Configure mTLS via certs (no token needed)
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");

			const user = mockSuccessfulAuth();

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({
				success: true,
				method: "mtls",
				user,
				token: "",
			});

			// Verify empty string token was persisted
			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("");

			// Should NOT prompt for token
			expect(vscode.window.showInputBox).not.toHaveBeenCalled();
		});

		it("shows error and returns failure when mTLS fails", async () => {
			const { mockConfig, coordinator, mockAuthFailure } = createTestContext();
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");
			mockAuthFailure("Certificate error");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result.success).toBe(false);
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to log in to Coder server",
				expect.objectContaining({ modal: true }),
			);

			// Should NOT prompt for token since it's mTLS
			expect(vscode.window.showInputBox).not.toHaveBeenCalled();
		});

		it("logs warning instead of showing dialog for autoLogin", async () => {
			const { mockConfig, logger, coordinator, mockAuthFailure } =
				createTestContext();
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");
			mockAuthFailure("Certificate error");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				autoLogin: true,
			});

			expect(result.success).toBe(false);
			expect(logger.warn).toHaveBeenCalled();
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});
	});

	describe("ensureLoggedInWithDialog", () => {
		it("returns success false when user dismisses dialog", async () => {
			const { mockConfig, userInteraction, coordinator } = createTestContext();
			// Use mTLS for simpler dialog test
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");

			// User dismisses dialog (returns undefined instead of "Login")
			userInteraction.setResponse("Authentication Required", undefined);

			const result = await coordinator.ensureLoggedInWithDialog({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				trigger: "auth_required",
			});

			expect(result.success).toBe(false);
		});
	});

	describe("token fallback order", () => {
		it("uses provided token first when valid", async () => {
			const { secretsManager, coordinator, mockSuccessfulAuth } =
				createTestContext();
			const user = mockSuccessfulAuth();

			// Store a different token
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "provided-token",
			});

			expect(result).toEqual({
				success: true,
				method: "provided_token",
				user,
				token: "provided-token",
			});
		});

		it("falls back to stored token when provided token is invalid", async () => {
			const { mockGetAuthenticatedUser, secretsManager, coordinator } =
				createTestContext();
			const user = createMockUser();

			// First call (provided token) fails with 401, second call (stored token) succeeds
			mockGetAuthenticatedUser
				.mockRejectedValueOnce(createAxiosError(401, "Unauthorized"))
				.mockResolvedValueOnce(user);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "invalid-provided-token",
			});

			expect(result).toEqual({
				success: true,
				method: "stored_token",
				user,
				token: "stored-token",
			});
		});

		it("prompts user when both provided and stored tokens are invalid", async () => {
			const {
				mockGetAuthenticatedUser,
				userInteraction,
				secretsManager,
				coordinator,
			} = createTestContext();
			const user = createMockUser();

			// First call (provided token) fails, second call (stored token) fails,
			// third call (user-entered token) succeeds
			mockGetAuthenticatedUser
				.mockRejectedValueOnce(createAxiosError(401, "Unauthorized"))
				.mockRejectedValueOnce(createAxiosError(401, "Unauthorized"))
				.mockResolvedValueOnce(user);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			userInteraction.setInputBoxValue("user-entered-token");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "invalid-provided-token",
			});

			expect(result).toEqual({
				success: true,
				method: "cli_token",
				user,
				token: "user-entered-token",
			});
			expect(vscode.window.showInputBox).toHaveBeenCalled();
		});

		it("skips stored token check when same as provided token", async () => {
			const {
				mockGetAuthenticatedUser,
				userInteraction,
				secretsManager,
				coordinator,
			} = createTestContext();
			const user = createMockUser();

			// First call (provided token = stored token) fails with 401,
			// second call (user-entered token) succeeds
			mockGetAuthenticatedUser
				.mockRejectedValueOnce(createAxiosError(401, "Unauthorized"))
				.mockResolvedValueOnce(user);

			// Store the SAME token as will be provided
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "same-token",
			});

			userInteraction.setInputBoxValue("user-entered-token");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "same-token",
			});

			expect(result).toEqual({
				success: true,
				method: "cli_token",
				user,
				token: "user-entered-token",
			});
			// Provided/stored token check only called once + user prompt
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(2);
		});
	});

	describe("keyring storage at login", () => {
		async function loginWithStoredToken() {
			const ctx = createTestContext();
			const user = ctx.mockSuccessfulAuth();
			await ctx.secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});
			const login = async () => {
				const result = await ctx.coordinator.ensureLoggedIn({
					url: TEST_URL,
					safeHostname: TEST_HOSTNAME,
				});
				// Flush the fire-and-forget storeToken promise
				await Promise.resolve();
				return result;
			};
			return { ...ctx, user, login };
		}

		it("calls storeToken after successful login", async () => {
			const { mockCredentialManager, login } = await loginWithStoredToken();

			await login();

			expect(mockCredentialManager.storeToken).toHaveBeenCalledWith(
				TEST_URL,
				"stored-token",
				expect.anything(),
			);
		});

		it("does not call storeToken for mTLS (empty token)", async () => {
			const {
				mockConfig,
				coordinator,
				mockCredentialManager,
				mockSuccessfulAuth,
			} = createTestContext();
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");
			mockSuccessfulAuth();

			await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(mockCredentialManager.storeToken).not.toHaveBeenCalled();
		});

		it("login succeeds even when keyring storage throws", async () => {
			const { mockCredentialManager, user, login } =
				await loginWithStoredToken();

			vi.mocked(mockCredentialManager.storeToken).mockRejectedValueOnce(
				new Error("keyring unavailable"),
			);

			const result = await login();

			expect(result).toEqual({
				success: true,
				method: "stored_token",
				user,
				token: "stored-token",
			});
		});
	});

	describe("telemetry", () => {
		const dialogOptions = (trigger: "auth_required" | "missing_session") => ({
			url: TEST_URL,
			safeHostname: TEST_HOSTNAME,
			trigger,
		});

		const enableMTLS = (mockConfig: MockConfigurationProvider) => {
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");
		};

		interface PromptCase {
			name: string;
			arrange: (ctx: ReturnType<typeof createTestContext>) => void;
			trigger: "auth_required" | "missing_session";
			expected: {
				result: "success" | "aborted" | "error";
				reason?: "user_dismissed" | "no_url_provided";
				"error.type"?: "auth_failed";
			};
		}

		it.each<PromptCase>([
			{
				name: "user dismisses the dialog: aborted + user_dismissed",
				arrange: (ctx) =>
					ctx.userInteraction.setResponse("Authentication Required", undefined),
				trigger: "missing_session",
				expected: { result: "aborted", reason: "user_dismissed" },
			},
			{
				name: "authentication fails: error + auth_failed",
				arrange: (ctx) => {
					enableMTLS(ctx.mockConfig);
					ctx.mockAuthFailure("Certificate error");
					vi.mocked(maybeAskUrl).mockResolvedValue(TEST_URL);
					ctx.userInteraction.setResponse("Authentication Required", "Login");
				},
				trigger: "auth_required",
				expected: { result: "error", "error.type": "auth_failed" },
			},
			{
				name: "user cancels URL prompt: aborted + no_url_provided",
				arrange: (ctx) => {
					enableMTLS(ctx.mockConfig);
					vi.mocked(maybeAskUrl).mockResolvedValue(undefined);
					ctx.userInteraction.setResponse("Authentication Required", "Login");
				},
				trigger: "auth_required",
				expected: { result: "aborted", reason: "no_url_provided" },
			},
			{
				name: "happy path: success and no reason",
				arrange: (ctx) => {
					enableMTLS(ctx.mockConfig);
					ctx.mockSuccessfulAuth();
					vi.mocked(maybeAskUrl).mockResolvedValue(TEST_URL);
					ctx.userInteraction.setResponse("Authentication Required", "Login");
				},
				trigger: "auth_required",
				expected: { result: "success" },
			},
		])("$name", async ({ arrange, trigger, expected }) => {
			const sink = new TestSink();
			const ctx = createTestContext(createTestTelemetryService(sink));
			arrange(ctx);

			await ctx.coordinator.ensureLoggedInWithDialog(dialogOptions(trigger));

			const event = sink.expectOne("auth.login_prompted");
			expect(event.properties).toMatchObject({ trigger, ...expected });
			if (expected.reason === undefined) {
				expect(event.properties.reason).toBeUndefined();
			}
			expect(event.error).toBeUndefined();
		});

		it("includes durationMs on the prompt span", async () => {
			const sink = new TestSink();
			const { userInteraction, coordinator } = createTestContext(
				createTestTelemetryService(sink),
			);
			userInteraction.setResponse("Authentication Required", undefined);

			await coordinator.ensureLoggedInWithDialog(
				dialogOptions("missing_session"),
			);

			expect(
				sink.expectOne("auth.login_prompted").measurements.durationMs,
			).toEqual(expect.any(Number));
		});
	});
});
