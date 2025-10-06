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
			await secretsManager.setSessionToken("test-token");
			expect(await secretsManager.getSessionToken()).toBe("test-token");

			await secretsManager.setSessionToken("new-token");
			expect(await secretsManager.getSessionToken()).toBe("new-token");
		});

		it("should delete token when empty or undefined", async () => {
			await secretsManager.setSessionToken("test-token");
			await secretsManager.setSessionToken("");
			expect(await secretsManager.getSessionToken()).toBeUndefined();

			await secretsManager.setSessionToken("test-token");
			await secretsManager.setSessionToken(undefined);
			expect(await secretsManager.getSessionToken()).toBeUndefined();
		});

		it("should return undefined for corrupted storage", async () => {
			await secretStorage.store("sessionToken", "valid-token");
			secretStorage.corruptStorage();

			expect(await secretsManager.getSessionToken()).toBeUndefined();
		});
	});

	describe("login state", () => {
		it("should trigger login events", async () => {
			const events: Array<AuthAction> = [];
			secretsManager.onDidChangeLoginState((state) => {
				events.push(state);
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("login");
			expect(events).toEqual([AuthAction.LOGIN]);
		});

		it("should trigger logout events", async () => {
			const events: Array<AuthAction> = [];
			secretsManager.onDidChangeLoginState((state) => {
				events.push(state);
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("logout");
			expect(events).toEqual([AuthAction.LOGOUT]);
		});

		it("should fire same event twice in a row", async () => {
			vi.useFakeTimers();
			const events: Array<AuthAction> = [];
			secretsManager.onDidChangeLoginState((state) => {
				events.push(state);
				return Promise.resolve();
			});

			await secretsManager.triggerLoginStateChange("login");
			vi.advanceTimersByTime(5);
			await secretsManager.triggerLoginStateChange("login");

			expect(events).toEqual([AuthAction.LOGIN, AuthAction.LOGIN]);
			vi.useRealTimers();
		});
	});
});
