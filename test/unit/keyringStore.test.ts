import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type KeyringEntry,
	KeyringStore,
	isKeyringSupported,
} from "@/keyringStore";

import { createMockLogger } from "../mocks/testHelpers";

/**
 * In-memory backing store that simulates the OS keyring.
 * Each call to `factory()` returns a fresh handle pointing to the same
 * shared state — matching real @napi-rs/keyring behavior where
 * `Entry.withTarget()` returns a new handle to the same credential.
 */
function createMockEntryFactory() {
	let password: string | null = null;
	let secret: Uint8Array | null = null;

	return {
		factory: (): KeyringEntry => ({
			getPassword: () => password,
			setPassword: (p: string) => {
				password = p;
			},
			getSecret: () => secret,
			setSecret: (s: Uint8Array) => {
				secret = s;
			},
			deleteCredential: () => {
				password = null;
				secret = null;
			},
		}),
		getRawPassword: () => password,
		getRawSecret: () => secret,
		hasCredential: () => password !== null || secret !== null,
	};
}

function stubPlatform(platform: string) {
	vi.stubGlobal("process", { ...process, platform });
}

function decodeBase64Json(raw: string): unknown {
	return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
}

function decodeSecretJson(raw: Uint8Array): unknown {
	return JSON.parse(Buffer.from(raw).toString("utf-8"));
}

function expectedEntry(host: string, token: string) {
	return { coder_url: host, api_token: token };
}

describe("isKeyringSupported", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		{ platform: "darwin", expected: true },
		{ platform: "win32", expected: true },
		{ platform: "linux", expected: false },
		{ platform: "freebsd", expected: false },
	])("returns $expected for $platform", ({ platform, expected }) => {
		stubPlatform(platform);
		expect(isKeyringSupported()).toBe(expected);
	});
});

describe("KeyringStore", () => {
	let store: KeyringStore;
	let mockEntry: ReturnType<typeof createMockEntryFactory>;

	beforeEach(() => {
		mockEntry = createMockEntryFactory();
		store = new KeyringStore(createMockLogger(), mockEntry.factory);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// CRUD behavior is platform-independent; darwin is used as the test platform.
	describe("token operations", () => {
		beforeEach(() => {
			stubPlatform("darwin");
		});

		it("sets and gets a token", () => {
			store.setToken("https://dev.coder.com", "my-token");
			expect(store.getToken("dev.coder.com")).toBe("my-token");
		});

		it("overwrites token for same deployment", () => {
			store.setToken("https://dev.coder.com", "old-token");
			store.setToken("https://dev.coder.com", "new-token");
			expect(store.getToken("dev.coder.com")).toBe("new-token");
		});

		it("preserves other deployments on set", () => {
			store.setToken("https://dev.coder.com", "token-1");
			store.setToken("https://staging.coder.com", "token-2");

			expect(store.getToken("dev.coder.com")).toBe("token-1");
			expect(store.getToken("staging.coder.com")).toBe("token-2");
		});

		it("returns undefined for missing deployment", () => {
			expect(store.getToken("unknown.coder.com")).toBeUndefined();
		});

		it("deletes token while preserving others", () => {
			store.setToken("https://dev.coder.com", "token-1");
			store.setToken("https://staging.coder.com", "token-2");

			store.deleteToken("dev.coder.com");

			expect(store.getToken("dev.coder.com")).toBeUndefined();
			expect(store.getToken("staging.coder.com")).toBe("token-2");
		});

		it("deletes entire credential when last token is removed", () => {
			store.setToken("https://dev.coder.com", "token-1");
			store.deleteToken("dev.coder.com");
			expect(store.getToken("dev.coder.com")).toBeUndefined();
			// OS keyring entry itself should be cleaned up, not left as empty JSON
			expect(mockEntry.hasCredential()).toBe(false);
		});

		it("handles delete of non-existent deployment gracefully", () => {
			store.setToken("https://dev.coder.com", "token-1");
			store.deleteToken("unknown.coder.com");
			expect(store.getToken("dev.coder.com")).toBe("token-1");
		});

		it("strips URL path and protocol, keeping only host", () => {
			store.setToken("https://dev.coder.com/some/path", "my-token");
			expect(store.getToken("dev.coder.com")).toBe("my-token");
		});

		it("finds token by safeHostname when map key has port", () => {
			store.setToken("https://dev.coder.com:3000", "my-token");
			expect(store.getToken("dev.coder.com")).toBe("my-token");
		});

		it("deletes token by safeHostname when map key has port", () => {
			store.setToken("https://dev.coder.com:3000", "my-token");
			store.deleteToken("dev.coder.com");
			expect(store.getToken("dev.coder.com")).toBeUndefined();
			expect(mockEntry.hasCredential()).toBe(false);
		});
	});

	describe("platform encoding", () => {
		it("macOS: base64-encoded JSON via password", () => {
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token");
			expect(decodeBase64Json(mockEntry.getRawPassword()!)).toEqual({
				"dev.coder.com": expectedEntry("dev.coder.com", "token"),
			});
		});

		it("macOS: returns undefined for corrupted credential", () => {
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token");
			mockEntry
				.factory()
				.setPassword(Buffer.from("not-valid-json").toString("base64"));
			expect(store.getToken("dev.coder.com")).toBeUndefined();
		});

		it("Windows: raw UTF-8 JSON via secret", () => {
			stubPlatform("win32");
			store.setToken("https://dev.coder.com", "token");
			expect(decodeSecretJson(mockEntry.getRawSecret()!)).toEqual({
				"dev.coder.com": expectedEntry("dev.coder.com", "token"),
			});
			// Verify the win32 read path also works
			expect(store.getToken("dev.coder.com")).toBe("token");
		});

		it("Windows: returns undefined for corrupted credential", () => {
			stubPlatform("win32");
			store.setToken("https://dev.coder.com", "token");
			mockEntry.factory().setSecret(Buffer.from("not-valid-json"));
			expect(store.getToken("dev.coder.com")).toBeUndefined();
		});

		it("preserves port in map key for CLI compatibility", () => {
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com:8080", "my-token");
			expect(decodeBase64Json(mockEntry.getRawPassword()!)).toEqual({
				"dev.coder.com:8080": expectedEntry("dev.coder.com:8080", "my-token"),
			});
		});

		it("throws on unsupported platform", () => {
			stubPlatform("linux");
			const msg = "Keyring is not supported on linux";
			expect(() => store.setToken("https://dev.coder.com", "t")).toThrow(msg);
			expect(() => store.getToken("dev.coder.com")).toThrow(msg);
			expect(() => store.deleteToken("dev.coder.com")).toThrow(msg);
		});
	});
});
