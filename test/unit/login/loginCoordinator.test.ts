import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { getHeaders } from "@/headers";
import { LoginCoordinator } from "@/login/loginCoordinator";

import {
	createMockLogger,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
	MockUserInteraction,
} from "../../mocks/testHelpers";

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

vi.mock("@/api/streamingFetchAdapter", () => ({
	createStreamingFetchAdapter: vi.fn(() => fetch),
}));

vi.mock("@/promptUtils");

// Type for axios with our mock adapter
type MockedAxios = typeof axios & { __mockAdapter: ReturnType<typeof vi.fn> };

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

/**
 * Creates a fresh test context with all dependencies.
 */
function createTestContext() {
	vi.resetAllMocks();

	const mockAdapter = (axios as MockedAxios).__mockAdapter;
	mockAdapter.mockImplementation(mockAxiosAdapterImpl);
	vi.mocked(getHeaders).mockResolvedValue({});

	// MockConfigurationProvider sets sensible defaults (httpClientLogLevel, tlsCertFile, tlsKeyFile)
	const mockConfig = new MockConfigurationProvider();
	// MockUserInteraction sets up vscode.window dialogs and input boxes
	const userInteraction = new MockUserInteraction();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);
	const mementoManager = new MementoManager(memento);

	const coordinator = new LoginCoordinator(
		secretsManager,
		mementoManager,
		vscode,
		logger,
	);

	const mockSuccessfulAuth = (user = createMockUser()) => {
		mockAdapter.mockResolvedValue({
			data: user,
			status: 200,
			statusText: "OK",
			headers: {},
			config: {},
		});
		return user;
	};

	const mockAuthFailure = (message = "Unauthorized") => {
		mockAdapter.mockRejectedValue({
			response: { status: 401, data: { message } },
			message,
		});
	};

	return {
		mockAdapter,
		mockConfig,
		userInteraction,
		secretsManager,
		mementoManager,
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

			expect(result).toEqual({ success: true, user, token: "stored-token" });

			const auth = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(auth?.token).toBe("stored-token");
		});

		it("prompts for token when no stored auth exists", async () => {
			const { mockAdapter, userInteraction, secretsManager, coordinator } =
				createTestContext();
			const user = createMockUser();

			// No stored token, so goes directly to input box flow
			// Mock succeeds when validateInput calls getAuthenticatedUser
			mockAdapter.mockResolvedValueOnce({
				data: user,
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			});

			// User enters a new token in the input box
			userInteraction.setInputBoxValue("new-token");

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({ success: true, user, token: "new-token" });

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
			const { mockAdapter, userInteraction, coordinator } = createTestContext();
			const user = createMockUser();

			// User enters a token in the input box
			userInteraction.setInputBoxValue("new-token");

			let resolveAuth: (value: unknown) => void;
			mockAdapter.mockReturnValue(
				new Promise((resolve) => {
					resolveAuth = resolve;
				}),
			);

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

			// Resolve the auth (this validates the token from input box)
			resolveAuth!({
				data: user,
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			});

			// Both should complete with the same result
			const [result1, result2] = await Promise.all([login1, login2]);
			expect(result1.success).toBe(true);
			expect(result1).toEqual(result2);

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

			expect(result).toEqual({ success: true, user, token: "" });

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
			const { mockConfig, secretsManager, mementoManager, mockAuthFailure } =
				createTestContext();
			mockConfig.set("coder.tlsCertFile", "/path/to/cert.pem");
			mockConfig.set("coder.tlsKeyFile", "/path/to/key.pem");

			const logger = createMockLogger();
			const coordinator = new LoginCoordinator(
				secretsManager,
				mementoManager,
				vscode,
				logger,
			);

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

			expect(result).toEqual({ success: true, user, token: "provided-token" });
		});

		it("falls back to stored token when provided token is invalid", async () => {
			const { mockAdapter, secretsManager, coordinator } = createTestContext();
			const user = createMockUser();

			mockAdapter
				.mockRejectedValueOnce({
					isAxiosError: true,
					response: { status: 401 }, // Fail the provided token with 401
					message: "Unauthorized",
				})
				.mockResolvedValueOnce({
					data: user,
					status: 200, // Succeed the stored token
					headers: {},
					config: {},
				});

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "invalid-provided-token",
			});

			expect(result).toEqual({ success: true, user, token: "stored-token" });
		});

		it("prompts user when both provided and stored tokens are invalid", async () => {
			const { mockAdapter, userInteraction, secretsManager, coordinator } =
				createTestContext();
			const user = createMockUser();

			mockAdapter
				.mockRejectedValueOnce({
					isAxiosError: true,
					response: { status: 401 }, // provided token
					message: "Unauthorized",
				})
				.mockRejectedValueOnce({
					isAxiosError: true,
					response: { status: 401 }, // stored token
					message: "Unauthorized",
				})
				.mockResolvedValueOnce({
					data: user,
					status: 200, // user-entered token
					headers: {},
					config: {},
				});

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
				user,
				token: "user-entered-token",
			});
			expect(vscode.window.showInputBox).toHaveBeenCalled();
		});

		it("skips stored token check when same as provided token", async () => {
			const { mockAdapter, userInteraction, secretsManager, coordinator } =
				createTestContext();
			const user = createMockUser();

			mockAdapter
				.mockRejectedValueOnce({
					isAxiosError: true,
					response: { status: 401 }, // provided token
					message: "Unauthorized",
				})
				.mockResolvedValueOnce({
					data: user,
					status: 200, // user-entered token
					headers: {},
					config: {},
				});

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
				user,
				token: "user-entered-token",
			});
			// Provided/stored token check only called once + user prompt
			expect(mockAdapter).toHaveBeenCalledTimes(2);
		});
	});
});
