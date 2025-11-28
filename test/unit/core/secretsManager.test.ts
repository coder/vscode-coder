import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CurrentDeploymentState,
	SecretsManager,
} from "@/core/secretsManager";

import {
	InMemoryMemento,
	InMemorySecretStorage,
} from "../../mocks/testHelpers";

describe("SecretsManager", () => {
	let secretStorage: InMemorySecretStorage;
	let memento: InMemoryMemento;
	let secretsManager: SecretsManager;

	beforeEach(() => {
		vi.useRealTimers();
		secretStorage = new InMemorySecretStorage();
		memento = new InMemoryMemento();
		secretsManager = new SecretsManager(secretStorage, memento);
	});

	describe("session auth", () => {
		it("should store and retrieve session auth", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(await secretsManager.getSessionToken("example.com")).toBe(
				"test-token",
			);
			expect(await secretsManager.getUrl("example.com")).toBe(
				"https://example.com",
			);

			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "new-token",
			});
			expect(await secretsManager.getSessionToken("example.com")).toBe(
				"new-token",
			);
		});

		it("should clear session auth", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			await secretsManager.clearSessionAuth("example.com");
			expect(
				await secretsManager.getSessionToken("example.com"),
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
				await secretsManager.getSessionToken("example.com"),
			).toBeUndefined();
		});

		it("should track known labels", async () => {
			expect(secretsManager.getKnownLabels()).toEqual([]);

			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example.com");

			await secretsManager.setSessionAuth("other-com", {
				url: "https://other.com",
				token: "other-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example.com");
			expect(secretsManager.getKnownLabels()).toContain("other-com");
		});

		it("should remove label on clearAllAuthData", async () => {
			await secretsManager.setSessionAuth("example.com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example.com");

			await secretsManager.clearAllAuthData("example.com");
			expect(secretsManager.getKnownLabels()).not.toContain("example.com");
		});

		it("should order labels by most recently accessed", async () => {
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

			expect(secretsManager.getKnownLabels()).toEqual([
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

			expect(secretsManager.getKnownLabels()).toEqual([
				"new.com",
				"host5.com",
				"host4.com",
			]);
			expect(await secretsManager.getSessionToken("host1.com")).toBeUndefined();
			expect(await secretsManager.getSessionToken("host2.com")).toBeUndefined();
		});
	});

	describe("current deployment", () => {
		it("should store and retrieve current deployment", async () => {
			const deployment = { url: "https://example.com", label: "example.com" };
			await secretsManager.setCurrentDeployment(deployment);

			const result = await secretsManager.getCurrentDeployment();
			expect(result).toEqual(deployment);
		});

		it("should clear current deployment with undefined", async () => {
			const deployment = { url: "https://example.com", label: "example.com" };
			await secretsManager.setCurrentDeployment(deployment);
			await secretsManager.setCurrentDeployment(undefined);

			const result = await secretsManager.getCurrentDeployment();
			expect(result).toBeUndefined();
		});

		it("should return undefined when no deployment set", async () => {
			const result = await secretsManager.getCurrentDeployment();
			expect(result).toBeUndefined();
		});

		it("should notify listeners on deployment change", async () => {
			vi.useFakeTimers();
			const events: Array<CurrentDeploymentState> = [];
			secretsManager.onDidChangeCurrentDeployment((state) => {
				events.push(state);
			});

			const deployments = [
				{ url: "https://example.com", label: "example.com" },
				{ url: "https://another.org", label: "another.org" },
				{ url: "https://another.org", label: "another.org" },
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
			expect(result).toBeUndefined();
		});
	});
});
