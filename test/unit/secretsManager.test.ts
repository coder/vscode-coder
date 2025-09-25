import { beforeEach, describe, expect, it } from "vitest";

import { SecretsManager } from "@/core/secretsManager";

import { InMemorySecretStorage } from "@tests/mocks/testHelpers";

describe("SecretsManager", () => {
	let secretStorage: InMemorySecretStorage;
	let secretsManager: SecretsManager;

	beforeEach(() => {
		secretStorage = new InMemorySecretStorage();
		secretsManager = new SecretsManager(secretStorage);
	});

	describe("setSessionToken", () => {
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
	});

	describe("getSessionToken", () => {
		it("should return undefined for corrupted storage", async () => {
			await secretStorage.store("sessionToken", "valid-token");
			secretStorage.corruptStorage();

			expect(await secretsManager.getSessionToken()).toBeUndefined();
		});
	});
});
