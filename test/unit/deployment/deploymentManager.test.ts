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
	InMemoryMemento,
	InMemorySecretStorage,
	MockCoderApi,
	MockConfigurationProvider,
	MockContextManager,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";

import type { OAuthSessionManager } from "@/oauth/sessionManager";
import type { WorkspaceProvider } from "@/workspace/workspacesProvider";

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

/**
 * Mock WorkspaceProvider for deployment tests.
 */
class MockWorkspaceProvider {
	readonly fetchAndRefresh = vi.fn();
	readonly clear = vi.fn();
}

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";
const managers: DeploymentManager[] = [];

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
	// For verifyAndApplyDeployment, we use a separate mock for validation
	const validationMockClient = new MockCoderApi();
	const mockWorkspaceProvider = new MockWorkspaceProvider();
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
		[mockWorkspaceProvider as unknown as WorkspaceProvider],
	);
	managers.push(manager);

	return {
		mockClient,
		validationMockClient,
		secretsManager,
		contextManager,
		mockOAuthSessionManager,
		mockWorkspaceProvider,
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
			expect(manager.isAuthenticated()).toBe(false);
		});

		it("returns deployment and isAuthenticated=true after setDeployment", async () => {
			const { manager } = createTestContext();
			const user = createMockUser();

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

			await manager.clearDeployment();

			expect(manager.getCurrentDeployment()).toBeNull();
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

	describe("verifyAndApplyDeployment", () => {
		it("returns true and sets deployment on auth success", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			const result = await manager.verifyAndApplyDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(result).toBe(true);
			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("test-token");
			expect(manager.isAuthenticated()).toBe(true);
		});

		it("returns false and does not set deployment on auth failure", async () => {
			const { validationMockClient, manager } = createTestContext();
			validationMockClient.setAuthenticatedUserResponse(
				new Error("Auth failed"),
			);

			const result = await manager.verifyAndApplyDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(result).toBe(false);
			expect(manager.getCurrentDeployment()).toBeNull();
			expect(manager.isAuthenticated()).toBe(false);
		});

		it("handles empty string token (mTLS) correctly", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			const result = await manager.verifyAndApplyDeployment({
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

			const result = await manager.verifyAndApplyDeployment({
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

			await manager.verifyAndApplyDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
			});

			expect(validationMockClient.disposed).toBe(true);
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
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("synced-token");
			expect(
				telemetrySink.expectOne("deployment.cross_window_detected").properties,
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
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockClient.host).toBe(TEST_URL);
			expect(mockClient.token).toBe("");
		});
	});

	describe("auth listener", () => {
		it("updates credentials on token change", async () => {
			const { mockClient, secretsManager, manager } = createTestContext();
			const user = createMockUser();

			// Set up authenticated deployment
			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "initial-token",
				user,
			});

			expect(mockClient.token).toBe("initial-token");
			expect(manager.isAuthenticated()).toBe(true);

			// Simulate token refresh via secrets change
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "refreshed-token",
			});

			// Wait for async handler
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockClient.token).toBe("refreshed-token");
			expect(manager.isAuthenticated()).toBe(true);
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

			await manager.clearDeployment();

			expect(mockClient.host).toBeUndefined();
			expect(mockClient.token).toBeUndefined();
			expect(contextManager.get("coder.authenticated")).toBe(false);
			expect(contextManager.get("coder.isOwner")).toBe(false);
		});

		it("resets the telemetry deployment URL on clearDeployment", async () => {
			const { setDeploymentUrlSpy, manager } = createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});
			await manager.clearDeployment();

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
			const {
				mockClient,
				contextManager,
				mockOAuthSessionManager,
				mockWorkspaceProvider,
				manager,
			} = createTestContext();

			await manager.setDeployment({
				url: TEST_URL,
				safeHostname: TEST_HOSTNAME,
				token: "test-token",
				user: createMockUser(),
			});
			expect(manager.isAuthenticated()).toBe(true);

			manager.suspendSession();

			// Auth state is cleared
			expect(mockOAuthSessionManager.clearDeployment).toHaveBeenCalled();
			expect(mockClient.host).toBeUndefined();
			expect(mockClient.token).toBeUndefined();
			expect(contextManager.get("coder.authenticated")).toBe(false);
			expect(manager.isAuthenticated()).toBe(false);
			expect(mockWorkspaceProvider.clear).toHaveBeenCalled();

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
				const { mockClient, validationMockClient, telemetrySink, manager } =
					createTestContext();
				const config = new MockConfigurationProvider();
				const user = createMockUser();
				validationMockClient.setAuthenticatedUserResponse(user);

				await manager.setDeployment({
					url: TEST_URL,
					safeHostname: TEST_HOSTNAME,
					token: "",
					user,
				});
				manager.suspendSession();
				expect(manager.isAuthenticated()).toBe(false);

				config.set("coder.tlsCertFile", "/path/to/cert.pem");
				config.set("coder.tlsKeyFile", "/path/to/key.pem");
				await vi.advanceTimersByTimeAsync(CONFIG_CHANGE_DEBOUNCE_MS);

				expect(mockClient.host).toBe(TEST_URL);
				expect(mockClient.token).toBe("");
				expect(manager.isAuthenticated()).toBe(true);
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
				manager.suspendSession();
				config.set("coder.tlsCertFile", "/path/to/cert.pem");
				await vi.advanceTimersByTimeAsync(CONFIG_CHANGE_DEBOUNCE_MS);

				await manager.clearDeployment();
				resolveAuth(user);
				await vi.runAllTimersAsync();

				expect(manager.getCurrentDeployment()).toBeNull();
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
			manager.suspendSession();
			expect(manager.isAuthenticated()).toBe(false);

			// Simulate token update (e.g., from another window or re-login)
			await secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "recovered-token",
			});

			await new Promise((resolve) => setImmediate(resolve));

			// Should recover and be authenticated again
			expect(mockClient.token).toBe("recovered-token");
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
				manager.suspendSession();
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
					telemetrySink.expectOne("deployment.auth_config_recovery_failed")
						.properties,
				).toEqual({});
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
