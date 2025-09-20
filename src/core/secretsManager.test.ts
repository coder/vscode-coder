import { describe, it, expect, beforeEach } from "vitest";
import type { SecretStorage, Event, SecretStorageChangeEvent } from "vscode";
import { SecretsManager } from "./secretsManager";

// Simple in-memory implementation of SecretStorage
class InMemorySecretStorage implements SecretStorage {
	private secrets = new Map<string, string>();
	private isCorrupted = false;

	onDidChange: Event<SecretStorageChangeEvent> = () => ({ dispose: () => {} });

	async get(key: string): Promise<string | undefined> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		return this.secrets.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		this.secrets.set(key, value);
	}

	async delete(key: string): Promise<void> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		this.secrets.delete(key);
	}

	corruptStorage(): void {
		this.isCorrupted = true;
	}
}

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
