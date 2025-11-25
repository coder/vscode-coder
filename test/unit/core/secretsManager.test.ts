import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthAction, SecretsManager } from "@/core/secretsManager";

import {
	InMemoryMemento,
	InMemorySecretStorage,
} from "../../mocks/testHelpers";

describe("SecretsManager", () => {
	let secretStorage: InMemorySecretStorage;
	let memento: InMemoryMemento;
	let secretsManager: SecretsManager;

	beforeEach(() => {
		secretStorage = new InMemorySecretStorage();
		memento = new InMemoryMemento();
		secretsManager = new SecretsManager(secretStorage, memento);
	});

	describe("session auth", () => {
		it("should store and retrieve session auth", async () => {
			await secretsManager.setSessionAuth("example-com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(await secretsManager.getSessionToken("example-com")).toBe(
				"test-token",
			);
			expect(await secretsManager.getUrl("example-com")).toBe(
				"https://example.com",
			);

			await secretsManager.setSessionAuth("example-com", {
				url: "https://example.com",
				token: "new-token",
			});
			expect(await secretsManager.getSessionToken("example-com")).toBe(
				"new-token",
			);
		});

		it("should clear session auth", async () => {
			await secretsManager.setSessionAuth("example-com", {
				url: "https://example.com",
				token: "test-token",
			});
			await secretsManager.clearSessionAuth("example-com");
			expect(
				await secretsManager.getSessionToken("example-com"),
			).toBeUndefined();
		});

		it("should return undefined for corrupted storage", async () => {
			await secretStorage.store(
				"coder.session.example-com",
				JSON.stringify({
					url: "https://example.com",
					token: "valid-token",
				}),
			);
			secretStorage.corruptStorage();

			expect(
				await secretsManager.getSessionToken("example-com"),
			).toBeUndefined();
		});

		it("should track known labels", async () => {
			expect(secretsManager.getKnownLabels()).toEqual([]);

			await secretsManager.setSessionAuth("example-com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example-com");

			await secretsManager.setSessionAuth("other-com", {
				url: "https://other.com",
				token: "other-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example-com");
			expect(secretsManager.getKnownLabels()).toContain("other-com");
		});

		it("should remove label on clearAllAuthData", async () => {
			await secretsManager.setSessionAuth("example-com", {
				url: "https://example.com",
				token: "test-token",
			});
			expect(secretsManager.getKnownLabels()).toContain("example-com");

			await secretsManager.clearAllAuthData("example-com");
			expect(secretsManager.getKnownLabels()).not.toContain("example-com");
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
