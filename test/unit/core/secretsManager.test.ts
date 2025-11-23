import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthAction, SecretsManager } from "@/core/secretsManager";

import { InMemorySecretStorage } from "../../mocks/testHelpers";

describe("SecretsManager", () => {
	let secretStorage: InMemorySecretStorage;
	let secretsManager: SecretsManager;

	beforeEach(() => {
		secretStorage = new InMemorySecretStorage();
		secretsManager = new SecretsManager(secretStorage);
	});

	describe("session token", () => {
		it("should store and retrieve tokens", async () => {
			await secretsManager.setSessionToken("example-com", {
				url: "https://example.com",
				sessionToken: "test-token",
			});
			expect(await secretsManager.getSessionToken("example-com")).toBe(
				"test-token",
			);

			await secretsManager.setSessionToken("example-com", {
				url: "https://example.com",
				sessionToken: "new-token",
			});
			expect(await secretsManager.getSessionToken("example-com")).toBe(
				"new-token",
			);
		});

		it("should delete token when undefined", async () => {
			await secretsManager.setSessionToken("example-com", {
				url: "https://example.com",
				sessionToken: "test-token",
			});
			await secretsManager.setSessionToken("example-com", undefined);
			expect(
				await secretsManager.getSessionToken("example-com"),
			).toBeUndefined();
		});

		it("should return undefined for corrupted storage", async () => {
			await secretStorage.store(
				"coder.sessionAuthMap",
				JSON.stringify({
					"example-com": {
						url: "https://example.com",
						sessionToken: "valid-token",
					},
				}),
			);
			secretStorage.corruptStorage();

			expect(
				await secretsManager.getSessionToken("example-com"),
			).toBeUndefined();
		});
	});

	describe("login state", () => {
		it("should trigger login events", async () => {
			const events: Array<{ state: AuthAction; label: string }> = [];
			secretsManager.onDidChangeLoginState((state, label) => {
				events.push({ state, label });
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("example-com", "login");
			expect(events).toEqual([
				{ state: AuthAction.LOGIN, label: "example-com" },
			]);
		});

		it("should trigger logout events", async () => {
			const events: Array<{ state: AuthAction; label: string }> = [];
			secretsManager.onDidChangeLoginState((state, label) => {
				events.push({ state, label });
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("example-com", "logout");
			expect(events).toEqual([
				{ state: AuthAction.LOGOUT, label: "example-com" },
			]);
		});

		it("should fire same event twice in a row", async () => {
			vi.useFakeTimers();
			const events: Array<{ state: AuthAction; label: string }> = [];
			secretsManager.onDidChangeLoginState((state, label) => {
				events.push({ state, label });
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("example-com", "login");
			vi.advanceTimersByTime(5);
			await secretsManager.triggerLoginStateChange("example-com", "login");

			expect(events).toEqual([
				{ state: AuthAction.LOGIN, label: "example-com" },
				{ state: AuthAction.LOGIN, label: "example-com" },
			]);
			vi.useRealTimers();
		});
	});
});
