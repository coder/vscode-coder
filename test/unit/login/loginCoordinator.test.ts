import axios, { type CreateAxiosDefaults } from "axios";
import { describe, expect, it, vi, type Mock } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { getHeaders } from "@/headers";
import { AuthTelemetry } from "@/instrumentation/auth";
import { LoginCoordinator, type LoginMethod } from "@/login/loginCoordinator";
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

import type { User } from "coder/site/src/api/typesGenerated";

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
	const mementoManager = new MementoManager(memento);
	const secretsManager = new SecretsManager(
		secretStorage,
		mementoManager,
		logger,
	);
	const oauthCallback = new OAuthCallback(secretStorage, logger);

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
		"0123456789abcdef0123456789abcdef",
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
			vi.mocked(mockCredentialManager.readToken).mockResolvedValueOnce({
				token: "cli-credential-token",
				source: "files",
			});

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

		it("reports keyring_token method when the credential comes from the keyring", async () => {
			const { mockCredentialManager, coordinator, mockSuccessfulAuth } =
				createTestContext();
			const user = mockSuccessfulAuth();
			vi.mocked(mockCredentialManager.readToken).mockResolvedValueOnce({
				token: "keyring-token",
				source: "keyring",
			});

			const result = await coordinator.ensureLoggedIn({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toEqual({
				success: true,
				method: "keyring_token",
				user,
				token: "keyring-token",
			});
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
		const SIGN_IN_PROMPT = "Sign in with the token from the link?";
		const LINK_TOKEN = "provided-token";
		const DISMISSED = { success: false, reason: "user_dismissed" };

		/** The result of a successful login, by the source of the token. */
		const signedIn = (method: LoginMethod, user: User, token: string) => ({
			success: true,
			method,
			user,
			token,
		});

		/** Test context plus shorthands for the link sign-in flow. */
		function createLinkTestContext() {
			const ctx = createTestContext();
			return {
				...ctx,
				/** Queue one getAuthenticatedUser result per expected call, in order. */
				authSequence: (...results: Array<User | "unauthorized">) => {
					for (const result of results) {
						if (result === "unauthorized") {
							mockGetAuthenticatedUser.mockRejectedValueOnce(
								createAxiosError(401, "Unauthorized"),
							);
						} else {
							mockGetAuthenticatedUser.mockResolvedValueOnce(result);
						}
					}
				},
				storeSession: (auth: {
					token: string;
					username?: string;
					url?: string;
				}) =>
					ctx.secretsManager.setSessionAuth(TEST_HOSTNAME, {
						url: TEST_URL,
						...auth,
					}),
				confirmSignIn: () =>
					ctx.userInteraction.setResponse(SIGN_IN_PROMPT, "Sign In"),
				dismissSignIn: () =>
					ctx.userInteraction.setResponse(SIGN_IN_PROMPT, undefined),
				login: (options?: { token?: string; tokenSignInConfirmed?: boolean }) =>
					ctx.coordinator.ensureLoggedIn({
						url: TEST_URL,
						safeHostname: TEST_HOSTNAME,
						token: LINK_TOKEN,
						...options,
					}),
				storedToken: async () =>
					(await ctx.secretsManager.getSessionAuth(TEST_HOSTNAME))?.token,
				/** Assert the prompt named the user and the session it replaces. */
				expectSignInPrompt: (username: string, replaces?: string) =>
					expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
						SIGN_IN_PROMPT,
						expect.objectContaining({
							detail:
								`${TEST_URL}\n\nThe link contains a token that signs you in as "${username}"` +
								`${replaces ? `, replacing your ${replaces}` : ""}.`,
						}),
						"Sign In",
					),
				expectNoPrompt: () =>
					expect(vscode.window.showWarningMessage).not.toHaveBeenCalled(),
			};
		}

		it("signs in with the provided token over an expired session, after confirmation", async () => {
			const t = createLinkTestContext();
			const user = createMockUser();
			t.authSequence(user, "unauthorized"); // link token, then stored token
			await t.storeSession({ token: "expired-stored-token" });
			t.confirmSignIn();

			expect(await t.login()).toEqual(
				signedIn("provided_token", user, LINK_TOKEN),
			);
			t.expectSignInPrompt(user.username, "expired session");
		});

		it("skips confirmation when the link signs in the same user on the same origin", async () => {
			const t = createLinkTestContext();
			const user = createMockUser();
			t.authSequence(user);
			await t.storeSession({
				token: "stored-token",
				username: user.username,
			});

			expect(await t.login()).toEqual(
				signedIn("provided_token", user, LINK_TOKEN),
			);
			t.expectNoPrompt();
			// The stored token is never checked; the link token is the intent.
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(1);
		});

		it("still asks for confirmation when the same user is on a different origin", async () => {
			const t = createLinkTestContext();
			const user = createMockUser();
			t.authSequence(user); // only the link token is checked
			await t.storeSession({
				url: "http://coder.example.com",
				token: "stored-token-for-other-origin",
				username: user.username,
			});
			t.dismissSignIn();

			expect(await t.login()).toEqual(DISMISSED);
			// The stored token is never sent to a different origin.
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(1);
			// The unchecked session is not called expired.
			t.expectSignInPrompt(
				user.username,
				`current session for "${user.username}"`,
			);
		});

		it("confirms a first-time link sign-in, naming the user", async () => {
			const t = createLinkTestContext();
			const user = t.mockSuccessfulAuth();
			t.confirmSignIn();

			expect(await t.login()).toEqual(
				signedIn("provided_token", user, LINK_TOKEN),
			);
			t.expectSignInPrompt(user.username);
		});

		it("switches to the link user after confirmation while the stored session is valid", async () => {
			const t = createLinkTestContext();
			const userA = createMockUser({ username: "user-a" });
			const userB = createMockUser({ username: "user-b" });
			// The link token authenticates as user B, the stored token as user A.
			t.authSequence(userB, userA);
			await t.storeSession({ token: "valid-stored-token", username: "user-a" });
			t.confirmSignIn();

			expect(await t.login()).toEqual(
				signedIn("provided_token", userB, LINK_TOKEN),
			);
			t.expectSignInPrompt("user-b", 'current session for "user-a"');
			expect(
				await t.secretsManager.getSessionAuth(TEST_HOSTNAME),
			).toMatchObject({ token: LINK_TOKEN, username: "user-b" });
		});

		it("fails the login when the link token is invalid, keeping the stored session", async () => {
			const t = createLinkTestContext();
			t.authSequence("unauthorized");
			await t.storeSession({ token: "valid-stored-token" });

			expect(await t.login({ token: "invalid-provided-token" })).toEqual({
				success: false,
				method: "provided_token",
				reason: "auth_failed",
			});
			t.expectNoPrompt();
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to log in to Coder server",
				expect.objectContaining({ modal: true }),
			);
			// The stored session stays untouched.
			expect(await t.storedToken()).toBe("valid-stored-token");
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(1);
		});

		it("skips the confirmation when the sign-in was already confirmed", async () => {
			const t = createLinkTestContext();
			const user = t.mockSuccessfulAuth();

			expect(await t.login({ tokenSignInConfirmed: true })).toEqual(
				signedIn("provided_token", user, LINK_TOKEN),
			);
			t.expectNoPrompt();
		});

		interface DismissedCase {
			name: string;
			/** The link token's result, then the stored token's (prompt wording). */
			auth: Array<User | "unauthorized">;
			session?: { url?: string; token: string; username?: string };
			/** The trust prompt already disclosed the sign-in. */
			preConfirmed?: boolean;
		}

		it.each<DismissedCase>([
			{
				name: "signs in for the first time",
				auth: [createMockUser()],
			},
			{
				name: "replaces an expired session",
				auth: [createMockUser(), "unauthorized"],
				session: { token: "expired-stored-token" },
			},
			{
				name: "signs in a different user over an expired session",
				auth: [createMockUser(), "unauthorized"],
				session: { token: "expired-stored-token", username: "someone-else" },
			},
			{
				name: "switches accounts over a valid session",
				auth: [
					createMockUser({ username: "user-b" }),
					createMockUser({ username: "user-a" }),
				],
				session: { token: "valid-stored-token", username: "user-a" },
			},
			{
				name: "was pre-confirmed but replaces another origin's session",
				auth: [createMockUser()],
				session: {
					url: "http://coder.example.com",
					token: "other-origin-token",
					username: "someone-else",
				},
				preConfirmed: true,
			},
			{
				name: "was pre-confirmed but replaces an expired session",
				auth: [createMockUser(), "unauthorized"],
				session: { token: "expired-stored-token", username: "someone-else" },
				preConfirmed: true,
			},
			{
				name: "was pre-confirmed but switches accounts",
				auth: [
					createMockUser({ username: "user-b" }),
					createMockUser({ username: "user-a" }),
				],
				session: { token: "valid-stored-token", username: "user-a" },
				preConfirmed: true,
			},
		])(
			"cancels a dismissed sign-in that $name, keeping the stored session",
			async ({ auth, session, preConfirmed }) => {
				const t = createLinkTestContext();
				t.authSequence(...auth);
				if (session) {
					await t.storeSession(session);
				}
				t.dismissSignIn();

				expect(await t.login({ tokenSignInConfirmed: preConfirmed })).toEqual(
					DISMISSED,
				);
				expect(await t.storedToken()).toBe(session?.token);
			},
		);

		it("does not fall back to other credentials when the link token is invalid", async () => {
			const t = createLinkTestContext();
			t.authSequence("unauthorized");
			await t.storeSession({ token: "expired-stored-token" });
			t.userInteraction.setInputBoxValue("user-entered-token");

			expect(await t.login({ token: "invalid-provided-token" })).toEqual({
				success: false,
				method: "provided_token",
				reason: "auth_failed",
			});
			// Neither the stored token, CLI credentials, nor a manual prompt runs.
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(1);
			expect(vscode.window.showInputBox).not.toHaveBeenCalled();
		});

		it("fails the login when the link repeats the stored token and it expired", async () => {
			const t = createLinkTestContext();
			t.authSequence("unauthorized");
			await t.storeSession({ token: "same-token" });

			expect(await t.login({ token: "same-token" })).toEqual({
				success: false,
				method: "provided_token",
				reason: "auth_failed",
			});
			// The shared token is checked once; no other source is tried.
			expect(mockGetAuthenticatedUser).toHaveBeenCalledTimes(1);
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
