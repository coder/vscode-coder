import { describe, expect, it, vi } from "vitest";

import { CoderApi } from "@/api/coderApi";
import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { DeploymentManager } from "@/deployment/deploymentManager";

import {
	createMockLogger,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
	MockCoderApi,
	MockOAuthSessionManager,
} from "../../mocks/testHelpers";

import type { ServiceContainer } from "@/core/container";
import type { ContextManager } from "@/core/contextManager";
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
 * Mock ContextManager for deployment tests.
 * Mimics real ContextManager which defaults to false for boolean contexts.
 */
class MockContextManager {
	private readonly contexts = new Map<string, boolean>();

	readonly set = vi.fn((key: string, value: boolean) => {
		this.contexts.set(key, value);
	});

	get(key: string): boolean {
		return this.contexts.get(key) ?? false;
	}
}

/**
 * Mock WorkspaceProvider for deployment tests.
 */
class MockWorkspaceProvider {
	readonly fetchAndRefresh = vi.fn();
	readonly clear = vi.fn();
}

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

/**
 * Creates a fresh test context with all dependencies.
 */
function createTestContext() {
	vi.resetAllMocks();

	const mockClient = new MockCoderApi();
	// For setDeploymentIfValid, we use a separate mock for validation
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

	const container = {
		getSecretsManager: () => secretsManager,
		getMementoManager: () => mementoManager,
		getContextManager: () => contextManager as unknown as ContextManager,
		getLogger: () => logger,
	};

	const manager = DeploymentManager.create(
		container as unknown as ServiceContainer,
		mockClient as unknown as CoderApi,
		mockOAuthSessionManager as unknown as OAuthSessionManager,
		[mockWorkspaceProvider as unknown as WorkspaceProvider],
	);

	return {
		mockClient,
		validationMockClient,
		secretsManager,
		contextManager,
		mockOAuthSessionManager,
		mockWorkspaceProvider,
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

	describe("setDeploymentIfValid", () => {
		it("returns true and sets deployment on auth success", async () => {
			const { mockClient, validationMockClient, manager } = createTestContext();
			const user = createMockUser();
			validationMockClient.setAuthenticatedUserResponse(user);

			const result = await manager.setDeploymentIfValid({
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

			const result = await manager.setDeploymentIfValid({
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

			const result = await manager.setDeploymentIfValid({
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

			const result = await manager.setDeploymentIfValid({
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

			await manager.setDeploymentIfValid({
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
			const { mockClient, validationMockClient, secretsManager } =
				createTestContext();
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
	});

	describe("suspendSession", () => {
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
		it("recovers from suspended state when tokens update", async () => {
			const { mockClient, validationMockClient, secretsManager, manager } =
				createTestContext();
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
		});
	});
});
