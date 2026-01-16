import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CurrentDeploymentState,
	SecretsManager,
	type SessionAuth,
} from "@/core/secretsManager";

import {
	InMemoryMemento,
	InMemorySecretStorage,
	createMockLogger,
} from "../../mocks/testHelpers";

import type { Deployment } from "@/deployment/types";

describe("SecretsManager", () => {
	let secretStorage: InMemorySecretStorage;
	let memento: InMemoryMemento;
	let secretsManager: SecretsManager;

	beforeEach(() => {
		vi.useRealTimers();
		secretStorage = new InMemorySecretStorage();
		memento = new InMemoryMemento();
		secretsManager = new SecretsManager(
			secretStorage,
			memento,
			createMockLogger(),
		);
	});

	describe("session auth", () => {
		it("should store and retrieve session auth", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			const auth = await secretsManager.getSessionAuth("example.com");
			expect(auth?.token).toBe("test-token");
			expect(auth?.url).toBe("https://example.com");

			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "new-token",
			});
			const newAuth = await secretsManager.getSessionAuth("example.com");
			expect(newAuth?.token).toBe("new-token");
		});

		it("should clear session auth", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			await secretsManager.clearAllAuthData("example.com");
			expect(
				await secretsManager.getSessionAuth("example.com"),
			).toBeUndefined();
		});

		it("should return undefined for corrupted storage", async () => {
			await secretStorage.store(
				"coder.session.example.com",
				JSON.stringify({
					url: "https://example.com",
					token: "valid-token",
				}),
			);
			secretStorage.corruptStorage();

			expect(
				await secretsManager.getSessionAuth("example.com"),
			).toBeUndefined();
		});

		it("should track known safe hostnames", async () => {
			expect(secretsManager.getKnownSafeHostnames()).toEqual([]);

			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownSafeHostnames()).toContain("example.com");

			await secretsManager.setSessionAuth("other-com", {
				url: "https://other.com",
				token: "other-token",
			});
			expect(secretsManager.getKnownSafeHostnames()).toContain("example.com");
			expect(secretsManager.getKnownSafeHostnames()).toContain("other-com");
		});

		it("should remove safe hostname on clearAllAuthData", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownSafeHostnames()).toContain("example.com");

			await secretsManager.clearAllAuthData("example.com");
			expect(secretsManager.getKnownSafeHostnames()).not.toContain(
				"example.com",
			);
		});

		it("should order safe hostnames by most recently accessed", async () => {
			await secretsManager.setSessionAuth("first.com", {
				url: "https://first.com",
				token: "token1",
			});
			await secretsManager.setSessionAuth("second.com", {
				url: "https://second.com",
				token: "token2",
			});
			await secretsManager.setSessionAuth("first.com", {
				url: "https://first.com",
				token: "token1-updated",
			});

			expect(secretsManager.getKnownSafeHostnames()).toEqual([
				"first.com",
				"second.com",
			]);
		});

		it("should prune old deployments when exceeding maxCount", async () => {
			for (let i = 1; i <= 5; i++) {
				await secretsManager.setSessionAuth(`host${i}.com`, {
					url: `https://host${i}.com`,
					token: `token${i}`,
				});
			}

			await secretsManager.recordDeploymentAccess("new.com", 3);

			expect(secretsManager.getKnownSafeHostnames()).toEqual([
				"new.com",
				"host5.com",
				"host4.com",
			]);
			expect(await secretsManager.getSessionAuth("host1.com")).toBeUndefined();
			expect(await secretsManager.getSessionAuth("host2.com")).toBeUndefined();
		});
	});

	describe("current deployment", () => {
		it("should store and retrieve current deployment", async () => {
			const deployment = {
				url: "https://example.com",
				safeHostname: "example.com",
			};
			await secretsManager.setCurrentDeployment(deployment);

			const result = await secretsManager.getCurrentDeployment();
			expect(result).toEqual(deployment);
		});

		it("should clear current deployment with undefined", async () => {
			const deployment = {
				url: "https://example.com",
				safeHostname: "example.com",
			};
			await secretsManager.setCurrentDeployment(deployment);
			await secretsManager.setCurrentDeployment(undefined);

			const result = await secretsManager.getCurrentDeployment();
			expect(result).toBeNull();
		});

		it("should return null when no deployment set", async () => {
			const result = await secretsManager.getCurrentDeployment();
			expect(result).toBeNull();
		});

		it("should notify listeners on deployment change", async () => {
			vi.useFakeTimers();
			const events: CurrentDeploymentState[] = [];
			secretsManager.onDidChangeCurrentDeployment((state) => {
				events.push(state);
			});

			const deployments = [
				{ url: "https://example.com", safeHostname: "example.com" },
				{ url: "https://another.org", safeHostname: "another.org" },
				{ url: "https://another.org", safeHostname: "another.org" },
			];
			await secretsManager.setCurrentDeployment(deployments[0]);
			vi.advanceTimersByTime(5);
			await secretsManager.setCurrentDeployment(deployments[1]);
			vi.advanceTimersByTime(5);
			await secretsManager.setCurrentDeployment(deployments[2]);
			vi.advanceTimersByTime(5);

			// Trigger an event even if the deployment did not change
			expect(events).toEqual(deployments.map((deployment) => ({ deployment })));
		});

		it("should handle corrupted storage gracefully", async () => {
			await secretStorage.store("coder.currentDeployment", "invalid-json{");

			const result = await secretsManager.getCurrentDeployment();
			expect(result).toBeNull();
		});
	});

	describe("migrateFromLegacyStorage", () => {
		it("migrates legacy url/token to new format and sets current deployment", async () => {
			// Set up legacy storage
			await memento.update("url", "https://legacy.coder.com");
			await secretStorage.store("sessionToken", "legacy-token");

			const result = await secretsManager.migrateFromLegacyStorage();

			// Should return the migrated hostname
			expect(result).toBe("legacy.coder.com");

			// Should have migrated to new format
			const auth = await secretsManager.getSessionAuth("legacy.coder.com");
			expect(auth?.url).toBe("https://legacy.coder.com");
			expect(auth?.token).toBe("legacy-token");

			// Should have set current deployment
			const deployment = await secretsManager.getCurrentDeployment();
			expect(deployment?.url).toBe("https://legacy.coder.com");
			expect(deployment?.safeHostname).toBe("legacy.coder.com");

			// Legacy keys should be cleared
			expect(memento.get("url")).toBeUndefined();
			expect(await secretStorage.get("sessionToken")).toBeUndefined();
		});

		it("does not overwrite existing session auth", async () => {
			// Set up existing auth
			await secretsManager.setSessionAuth("existing.coder.com", {
				url: "https://existing.coder.com",
				token: "existing-token",
			});

			// Set up legacy storage with same hostname
			await memento.update("url", "https://existing.coder.com");
			await secretStorage.store("sessionToken", "legacy-token");

			await secretsManager.migrateFromLegacyStorage();

			// Existing auth should not be overwritten
			const auth = await secretsManager.getSessionAuth("existing.coder.com");
			expect(auth?.token).toBe("existing-token");
		});

		it("returns undefined when no legacy data exists", async () => {
			const result = await secretsManager.migrateFromLegacyStorage();
			expect(result).toBeUndefined();
		});

		it("migrates with empty token when only URL exists (mTLS)", async () => {
			await memento.update("url", "https://legacy.coder.com");

			const result = await secretsManager.migrateFromLegacyStorage();
			expect(result).toBe("legacy.coder.com");

			const auth = await secretsManager.getSessionAuth("legacy.coder.com");
			expect(auth?.url).toBe("https://legacy.coder.com");
			expect(auth?.token).toBe("");
		});
	});

	describe("session auth - empty token handling (mTLS)", () => {
		it("stores and retrieves empty string token", async () => {
			await secretsManager.setSessionAuth("mtls.coder.com", {
				url: "https://mtls.coder.com",
				token: "",
			});

			const auth = await secretsManager.getSessionAuth("mtls.coder.com");
			expect(auth?.token).toBe("");
			expect(auth?.url).toBe("https://mtls.coder.com");
		});
	});

	describe("schema validation", () => {
		describe("write validation - strips extra fields", () => {
			it("strips extra fields from SessionAuth", async () => {
				const authWithExtra = {
					url: "https://coder.example.com",
					token: "test-token",
					extraField: "should be stripped",
				};

				await secretsManager.setSessionAuth(
					"example.com",
					authWithExtra as SessionAuth,
				);

				const raw = await secretStorage.get("coder.session.example.com");
				expect(JSON.parse(raw!)).toEqual({
					url: "https://coder.example.com",
					token: "test-token",
				});
			});

			it("strips extra fields from nested OAuth data", async () => {
				const authWithExtra = {
					url: "https://coder.example.com",
					token: "test-token",
					oauth: {
						scope: "workspace:read",
						expiry_timestamp: 12345,
						extraOAuthField: "stripped",
					},
				};

				await secretsManager.setSessionAuth(
					"example.com",
					authWithExtra as SessionAuth,
				);

				const raw = await secretStorage.get("coder.session.example.com");
				expect(JSON.parse(raw!)).toEqual({
					url: "https://coder.example.com",
					token: "test-token",
					oauth: { scope: "workspace:read", expiry_timestamp: 12345 },
				});
			});

			it("strips extra fields from current deployment", async () => {
				const deploymentWithExtra = {
					url: "https://coder.example.com",
					safeHostname: "coder.example.com",
					extraField: "should be stripped",
				};

				await secretsManager.setCurrentDeployment(
					deploymentWithExtra as Deployment,
				);

				const raw = await secretStorage.get("coder.currentDeployment");
				const parsed = JSON.parse(raw!) as { deployment: unknown };
				expect(parsed.deployment).toEqual({
					url: "https://coder.example.com",
					safeHostname: "coder.example.com",
				});
			});
		});

		describe("read validation - returns fallback for invalid data", () => {
			interface InvalidDataTestCase {
				name: string;
				key: string;
				data: Record<string, unknown>;
				expected: unknown;
			}

			const sessionAuthCases: InvalidDataTestCase[] = [
				{
					name: "wrong field type",
					key: "coder.session.example.com",
					data: { url: 123, token: "test-token" },
					expected: undefined,
				},
				{
					name: "missing required field",
					key: "coder.session.example.com",
					data: { url: "https://coder.example.com" },
					expected: undefined,
				},
			];

			it.each(sessionAuthCases)(
				"returns undefined for SessionAuth with $name",
				async ({ key, data, expected }) => {
					await secretStorage.store(key, JSON.stringify(data));
					const result = await secretsManager.getSessionAuth("example.com");
					expect(result).toEqual(expected);
				},
			);

			it("returns null for current deployment with invalid shape", async () => {
				await secretStorage.store(
					"coder.currentDeployment",
					JSON.stringify({ deployment: { url: 123, safeHostname: "x" } }),
				);
				expect(await secretsManager.getCurrentDeployment()).toBeNull();
			});

			it("returns empty array for invalid deployment usage data", async () => {
				await memento.update("coder.deploymentUsage", [{ safeHostname: 123 }]);
				expect(secretsManager.getKnownSafeHostnames()).toEqual([]);
			});
		});

		describe("backwards compatibility", () => {
			interface BackwardsCompatTestCase {
				name: string;
				key: string;
				data: Record<string, unknown>;
				expected: unknown;
			}

			const sessionAuthCases: BackwardsCompatTestCase[] = [
				{
					name: "without optional oauth field",
					key: "coder.session.example.com",
					data: { url: "https://coder.example.com", token: "test-token" },
					expected: { url: "https://coder.example.com", token: "test-token" },
				},
				{
					name: "with OAuth without optional fields",
					key: "coder.session.example.com",
					data: {
						url: "https://coder.example.com",
						token: "test-token",
						oauth: { scope: "workspace:read", expiry_timestamp: 12345 },
					},
					expected: {
						url: "https://coder.example.com",
						token: "test-token",
						oauth: { scope: "workspace:read", expiry_timestamp: 12345 },
					},
				},
			];

			it.each(sessionAuthCases)(
				"handles SessionAuth $name",
				async ({ key, data, expected }) => {
					await secretStorage.store(key, JSON.stringify(data));
					const result = await secretsManager.getSessionAuth("example.com");
					expect(result).toEqual(expected);
				},
			);

			it("handles current deployment with null deployment", async () => {
				await secretStorage.store(
					"coder.currentDeployment",
					JSON.stringify({ deployment: null, timestamp: "2024-01-01" }),
				);
				expect(await secretsManager.getCurrentDeployment()).toBeNull();
			});
		});
	});
});
