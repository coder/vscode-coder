import { afterEach, describe, expect, it, vi } from "vitest";

import { CoderApi } from "@/api/coderApi";
import { CONFIG_CHANGE_DEBOUNCE_MS } from "@/configWatcher";
import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { DeploymentManager } from "@/deployment/deploymentManager";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	createMockServiceContainer,
	createMockUser,
	flush,
	InMemoryMemento,
	InMemorySecretStorage,
	MockCoderApi,
	MockConfigurationProvider,
	MockContextManager,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";

import type { OAuthSessionManager } from "@/oauth/sessionManager";

// Mock CoderApi.create to return our mock client for validation
vi.mock("@/api/coderApi", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/api/coderApi")>();
	return {
		...original,
		CoderApi: {
			...original.CoderApi,
			create: vi.fn(),
		},
	};
});

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";
const managers: DeploymentManager[] = [];

function currentUserId(manager: DeploymentManager): string | undefined {
	const snapshot = manager.getSnapshot();
	return snapshot.kind === "signedIn" ? snapshot.userId : undefined;
}

afterEach(() => {
	for (const manager of managers) {
		manager.dispose();
	}
	managers.length = 0;
});

/**
 * Creates a fresh test context with all dependencies.
 */
function createTestContext() {
	vi.resetAllMocks();
	new MockConfigurationProvider();

	const mockClient = new MockCoderApi();
	// For verifyAndApplySession, we use a separate mock for validation
	const validationMockClient = new MockCoderApi();
	const mockOAuthSessionManager = new MockOAuthSessionManager();
	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);
	const mementoManager = new MementoManager(memento);
	const contextManager = new MockContextManager();

	// Configure CoderApi.create mock to return validation client
	vi.mocked(CoderApi.create).mockReturnValue(
		validationMockClient as unknown as CoderApi,
	);

	const telemetrySink = new TestSink();
	const telemetryService = createTestTelemetryService(telemetrySink);
	const setDeploymentUrlSpy = vi.spyOn(telemetryService, "setDeploymentUrl");

	const manager = DeploymentManager.create(
		createMockServiceContainer({
			telemetry: telemetryService,
			logger,
			secretsManager,
			mementoManager,
			contextManager,
		}),
		mockClient as unknown as CoderApi,
		mockOAuthSessionManager as unknown as OAuthSessionManager,
	);
	managers.push(manager);

	return {
		mockClient,
		validationMockClient,
		secretsManager,
		contextManager,
		mockOAuthSessionManager,
		telemetrySink,
		telemetryService,
		setDeploymentUrlSpy,
		manager,
	};
}

describe("DeploymentManager", () => {
	describe("deployment state", () => {
		it("returns null and isAuthenticated=false with no deployment", () => {
			const { manager } = createTestContext();

			expect(manager.getCurrentDeployment()).toBeNull();
			expect(currentUserId(manager)).toBeUndefined();
			expect(manager.isAuthenticated()).toBe(false);
		});

		it("returns deployment and isAuthenticated=true after setDeployment", async () => {
			const { manager } = createTestContext();
			const user = createMockUser({ id: "current-user" });

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user,
			});

			expect(manager.getCurrentDeployment()).toMatchObject({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});
			expect(currentUserId(manager)).toBe("current-user");
			expect(manager.isAuthenticated()).toBe(true);
		});

		it("clears state after logout", async () => {
			const { manager } = createTestContext();
			const user = createMockUser();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user,
			});

			await manager.clearDeployment("credentials_removed");

			expect(manager.getCurrentDeployment()).toBeNull();
			expect(currentUserId(manager)).toBeUndefined();
			expect(manager.isAuthenticated()).toBe(false);
		});
	});

	describe("setDeployment", () => {
		it("sets credentials, refreshes workspaces, persists deployment", async () => {
			const { mockClient, secretsManager, contextManager, manager } =
				createTestContext();
			const user = createMockUser();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user,
			});

			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("test-token");
			expect(contextManager.get("coder.authenticated")).toBe(true);
			expect(contextManager.get("coder.isOwner")).toBe(false);

			const persisted = await secretsManager.getCurrentDeployment();
			expect(persisted?.url).toBe(TEST_URL);
		});

		it("does not persist a deployment after a newer state wins", async () => {
			const { mockOAuthSessionManager, secretsManager, manager } =
				createTestContext();
			const oauthSetDeployment = Promise.withResolvers<void>();
			mockOAuthSessionManager.setDeployment.mockReturnValueOnce(
				oauthSetDeployment.promise,
			);
			const firstSetDeployment = manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});

			await flush();
			await manager.clearDeployment("logout");
			oauthSetDeployment.resolve();
			await firstSetDeployment;

			expect(await secretsManager.getCurrentDeployment()).toBeNull();
			expect(manager.isAuthenticated()).toBe(false);
		});

		it("notifies telemetry of the deployment URL", async () => {
			const { setDeploymentUrlSpy, manager } = createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});

			expect(setDeploymentUrlSpy).toHaveBeenCalledWith(TEST_URL);
		});

		it("sets isOwner context when user has owner role", async () => {
			const { contextManager, manager } = createTestContext();
			const ownerUser = createMockUser({
				roles: [{ name: "owner", display_name: "Owner", organization_id: "" }],
			});

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: ownerUser,
			});

			expect(contextManager.get("coder.isOwner")).toBe(true);
		});
	});

	describe("verifyAndApplySession", () => {
		it("returns true and sets deployment on auth success", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			const result = await manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(result).toBe(true);
			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("test-token");
			expect(currentUserId(manager)).toBe(user.id);
			expect(manager.isAuthenticated()).toBe(true);
		});

		it("returns false and does not set deployment on auth failure", async () => {
			const { validationMockClient, manager } = createTestContext();
			validationMockClient.setAuthenticatedUserResponse(
				new Error("Auth failed"),
			);

			const result = await manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(result).toBe(false);
			expect(manager.getCurrentDeployment()).toBeNull();
			expect(currentUserId(manager)).toBeUndefined();
			expect(manager.isAuthenticated()).toBe(false);
		});

		it("handles empty string token (mTLS) correctly", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			const result = await manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "",
			});

			expect(result).toBe(true);
			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("");
			expect(manager.isAuthenticated()).toBe(true);
		});

		it("fetches token from secrets when not provided", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			// Store token in secrets
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "stored-token",
			});

			const result = await manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			expect(result).toBe(true);
			expect(mockClient.token).toBe("stored-token");
		});

		it("disposes validation client after use", async () => {
			const { validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			await manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(validationMockClient.disposed).toBe(true);
		});

		it("does not apply stale validation after a concurrent login", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const remoteUser = createMockUser({ id: "remote-user" });
			const localUser = createMockUser({ id: "local-user" });
			const validation = Promise.withResolvers<typeof remoteUser>();
			validationMockClient.getAuthenticatedUser.mockReturnValueOnce(
				validation.promise,
			);
			const remoteLogin = manager.verifyAndApplySession({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "remote-token",
			});

			await flush();
			await manager.setDeployment({
				url: "https://local.example.com",
				safeHostname: "local.example.com",
				token: "local-token",
				user: localUser,
			});
			validation.resolve(remoteUser);

			expect(await remoteLogin).toBe(false);
			expect(mockClient.host).toBe("https://local.example.com");
			expect(mockClient.token).toBe("local-token");
			expect(currentUserId(manager)).toBe("local-user");
		});
	});

	describe("cross-window sync", () => {
		it("ignores changes when already authenticated", async () => {
			const { mockClient, secretsManager, manager } = createTestContext();
			const user = createMockUser();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user,
			});

			// Simulate cross-window change by directly updating secrets
			await secretsManager.setCurrentDeployment({
				url: "https://other.example.com",
				safeHostname: "other.example.com",
			});

			// Should still have original credentials
			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("test-token");
		});

		it("picks up deployment when not authenticated", async () => {
			const {
				mockClient,
				validationMockClient,
				secretsManager,
				telemetrySink,
			} = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			// Set up auth in secrets before triggering cross-window sync
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "synced-token",
			});

			// Simulate cross-window change
			await secretsManager.setCurrentDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			// Wait for async handler
			await flush();

			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("synced-token");
			expect(
				telemetrySink.expectOne("deployment.cross_window.detected").properties,
			).toEqual({});
			expect(telemetrySink.expectOne("deployment.recovered")).toMatchObject({
				properties: { trigger: "cross_window" },
			});
		});

		it("handles mTLS deployment (empty token) from other window", async () => {
			const { mockClient, validationMockClient, secretsManager } =
				createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "",
			});

			await secretsManager.setCurrentDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});

			// Wait for async handler
			await flush();

			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("");
		});
	});

	describe("auth listener", () => {
		it("updates credentials and user on token change", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser({ id: "initial-user" });
			const refreshedUser = createMockUser({
				id: "refreshed-user",
				username: "refresheduser",
			});
			validationMockClient.setAuthenticatedUserResponse(refreshedUser);

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});

			expect(mockClient.token).toBe("initial-token");
			expect(currentUserId(manager)).toBe("initial-user");
			expect(manager.isAuthenticated()).toBe(true);

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "refreshed-token",
			});
			await flush();

			expect(mockClient.token).toBe("refreshed-token");
			expect(currentUserId(manager)).toBe("refreshed-user");
			expect(manager.isAuthenticated()).toBe(true);
		});

		it("does not apply stale token validation after logout", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser({ id: "initial-user" });
			const refreshedUser = createMockUser({ id: "refreshed-user" });
			const validation = Promise.withResolvers<typeof refreshedUser>();
			validationMockClient.getAuthenticatedUser.mockReturnValueOnce(
				validation.promise,
			);
			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "refreshed-token",
			});
			await flush();
			await manager.clearDeployment("logout");
			validation.resolve(refreshedUser);
			await flush();

			expect(mockClient.host).toBeUndefined();
			expect(mockClient.token).toBeUndefined();
			expect(manager.getCurrentDeployment()).toBeNull();
			expect(currentUserId(manager)).toBeUndefined();
		});

		it("rotates the token in place without a revision bump when the user is unchanged", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser({ id: "stable-user" });
			validationMockClient.setAuthenticatedUserResponse(user);

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});
			const revisionBefore = manager.getSnapshot().revision;

			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "rotated-token",
			});
			await flush();

			expect(mockClient.token).toBe("rotated-token");
			expect(currentUserId(manager)).toBe("stable-user");
			// No sign-in fired, so the workspace trees are not rebuilt.
			expect(manager.getSnapshot().revision).toBe(revisionBefore);
		});

		it("keeps the existing session when verifying a rotated token fails", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser({ id: "stable-user" });

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});

			// Verifying the rotated token fails (e.g. a transient network blip).
			validationMockClient.getAuthenticatedUser.mockRejectedValueOnce(
				new Error("network down"),
			);
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "rotated-token",
			});
			await flush();

			// Verify-before-apply: the unverified token never reaches the client.
			expect(mockClient.token).toBe("initial-token");
			expect(manager.isAuthenticated()).toBe(true);
			expect(currentUserId(manager)).toBe("stable-user");
		});

		it("recovers a session suspended while a rotated token is verified", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
			const user = createMockUser({ id: "stable-user" });
			const validation = Promise.withResolvers<typeof user>();
			validationMockClient.getAuthenticatedUser.mockReturnValueOnce(
				validation.promise,
			);

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "rotated-token",
			});
			await flush();

			// A concurrent 401 on the old token suspends the session mid-verify.
			manager.suspendSession("auth_failure");
			expect(manager.isAuthenticated()).toBe(false);

			validation.resolve(user);
			await flush();

			// The verified token recovers the session instead of staying suspended.
			expect(manager.isAuthenticated()).toBe(true);
			expect(mockClient.token).toBe("rotated-token");
			expect(currentUserId(manager)).toBe("stable-user");
		});
	});

	describe("logout", () => {
		it("clears credentials and updates contexts", async () => {
			const { mockClient, contextManager, manager } = createTestContext();
			const user = createMockUser();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user,
			});

			await manager.clearDeployment("credentials_removed");

			expect(mockClient.host).toBeUndefined();
			expect(mockClient.token).toBeUndefined();
			expect(contextManager.get("coder.authenticated")).toBe(false);
			expect(contextManager.get("coder.isOwner")).toBe(false);
			expect(currentUserId(manager)).toBeUndefined();
		});

		it("resets the telemetry deployment URL on clearDeployment", async () => {
			const { setDeploymentUrlSpy, manager } = createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});
			await manager.clearDeployment("credentials_removed");

			expect(setDeploymentUrlSpy).toHaveBeenLastCalledWith("");
		});
	});

	describe("suspendSession", () => {
		it("emits deployment.suspended once for an authenticated session", async () => {
			const { manager, telemetrySink } = createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});

			manager.suspendSession("auth_failure");
			manager.suspendSession("auth_failure");

			const events = telemetrySink.eventsNamed("deployment.suspended");
			expect(events).toHaveLength(1);
			expect(events[0].properties).toEqual({ reason: "auth_failure" });
		});

		it("clears auth state but keeps deployment for re-login", async () => {
			const { mockClient, contextManager, mockOAuthSessionManager, manager } =
				createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});
			expect(manager.isAuthenticated()).toBe(true);

			manager.suspendSession("auth_failure");

			// Auth state is cleared
			expect(mockOAuthSessionManager.clearDeployment).toHaveBeenCalled();
			expect(mockClient.host).toBeUndefined();
			expect(mockClient.token).toBeUndefined();
			expect(contextManager.get("coder.authenticated")).toBe(false);
			expect(currentUserId(manager)).toBeUndefined();
			expect(manager.isAuthenticated()).toBe(false);

			// Deployment is retained for easy re-login
			expect(manager.getCurrentDeployment()).toMatchObject({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
			});
		});
	});

	describe("auth listener recovery", () => {
		it("recovers from suspended state when auth settings change", async () => {
			vi.useFakeTimers();
			try {
				const {
					mockClient,
					validationMockClient,
					secretsManager,
					telemetrySink,
					manager,
				} = createTestContext();
				const config = new MockConfigurationProvider();
				const user = createMockUser();
				validationMockClient.setAuthenticatedUserResponse(user);

				await secretsManager.setSessionAuth(TEST_HOSTNAME, {
					url: TEST_URL,
					token: "",
				});
				await manager.setDeployment({
					url: TEST_URL,
					safeHostname: TEST_HOSTNAME,
					token: "",
					user,
				});
				manager.suspendSession("auth_failure");
				expect(manager.isAuthenticated()).toBe(false);

				config.set("coder.tlsCertFile", "/path/to/cert.pem");
				config.set("coder.tlsKeyFile", "/path/to/key.pem");
				await vi.advanceTimersByTimeAsync(CONFIG_CHANGE_DEBOUNCE_MS);

				expect(mockClient.host).toBe(TEST_URL);
				expect(mockClient.token).toBe("");
				expect(manager.isAuthenticated()).toBe(true);
				expect(currentUserId(manager)).toBe(user.id);
				expect(validationMockClient.getAuthenticatedUser).toHaveBeenCalledTimes(
					1,
				);
				expect(telemetrySink.expectOne("deployment.recovered")).toMatchObject({
					properties: { trigger: "auth_config" },
				});
			} finally {
				vi.useRealTimers();
			}
		});

		it("does not resurrect a concurrent clearDeployment during recovery", async () => {
			vi.useFakeTimers();
			try {
				const { validationMockClient, manager } = createTestContext();
				const config = new MockConfigurationProvider();
				const user = createMockUser();

				// Pause validation so a clearDeployment can race in.
				let resolveAuth!: (u: typeof user) => void;
				validationMockClient.getAuthenticatedUser.mockReturnValue(
					new Promise((resolve) => {
						resolveAuth = resolve;
					}),
				);

				await manager.setDeployment({
					url: TEST_URL,
					safeHostname: TEST_HOSTNAME,
					token: "",
					user,
				});
				manager.suspendSession("auth_failure");
				config.set("coder.tlsCertFile", "/path/to/cert.pem");
				await vi.advanceTimersByTimeAsync(CONFIG_CHANGE_DEBOUNCE_MS);

				await manager.clearDeployment("credentials_removed");
				resolveAuth(user);
				await vi.runAllTimersAsync();

				expect(manager.getCurrentDeployment()).toBeNull();
				expect(currentUserId(manager)).toBeUndefined();
				expect(manager.isAuthenticated()).toBe(false);
			} finally {
				vi.useRealTimers();
			}
		});

		it("recovers from suspended state when tokens update", async () => {
			const {
				mockClient,
				validationMockClient,
				secretsManager,
				telemetrySink,
				manager,
			} = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			// Set up authenticated deployment
			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});

			// Suspend session (simulates session expiry)
			manager.suspendSession("auth_failure");
			expect(manager.isAuthenticated()).toBe(false);

			// Simulate token update (e.g., from another window or re-login)
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "recovered-token",
			});

			await flush();

			// Should recover and be authenticated again
			expect(mockClient.token).toBe("recovered-token");
			expect(currentUserId(manager)).toBe(user.id);
			expect(manager.isAuthenticated()).toBe(true);
			expect(telemetrySink.expectOne("deployment.recovered")).toMatchObject({
				properties: { trigger: "token_update" },
			});
		});

		it("logs failed auth-config recovery", async () => {
			vi.useFakeTimers();
			try {
				const { validationMockClient, telemetrySink, manager } =
					createTestContext();
				const config = new MockConfigurationProvider();
				const user = createMockUser();

				await manager.setDeployment({
					url: TEST_URL,
					safeHostname: TEST_HOSTNAME,
					token: "test-token",
					user,
				});
				manager.suspendSession("auth_failure");
				validationMockClient.setAuthenticatedUserResponse(
					new Error("Auth failed"),
				);

				config.set("coder.tlsCertFile", "/path/to/cert.pem");
				await vi.advanceTimersByTimeAsync(CONFIG_CHANGE_DEBOUNCE_MS);

				expect(manager.isAuthenticated()).toBe(false);
				expect(telemetrySink.eventsNamed("deployment.recovered")).toHaveLength(
					0,
				);
				expect(
					telemetrySink.expectOne("deployment.auth_config.recovery_failed")
						.properties,
				).toEqual({});
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
