import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type KeyringEntry,
	KeyringStore,
	isKeyringSupported,
} from "@/keyringStore";

import { createMockLogger } from "../mocks/testHelpers";

/**
 * In-memory backing store that simulates the OS keyring.
 * Each call to `factory()` returns a fresh handle pointing to the same
 * shared state, matching real @napi-rs/keyring behavior where
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

function createTestContext() {
	const mockEntry = createMockEntryFactory();
	const store = new KeyringStore(createMockLogger(), mockEntry.factory);
	return { store, mockEntry };
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
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// CRUD behavior is platform-independent; darwin is used as the test platform.
	describe("token operations", () => {
		it("sets and gets a token", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "my-token");
			expect(store.getToken("dev.coder.com")).toBe("my-token");
		});

		it("overwrites token for same deployment", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "old-token");
			store.setToken("https://dev.coder.com", "new-token");
			expect(store.getToken("dev.coder.com")).toBe("new-token");
		});

		it("preserves other deployments on set", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token-1");
			store.setToken("https://staging.coder.com", "token-2");

			expect(store.getToken("dev.coder.com")).toBe("token-1");
			expect(store.getToken("staging.coder.com")).toBe("token-2");
		});

		it("returns undefined for missing deployment", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			expect(store.getToken("unknown.coder.com")).toBeUndefined();
		});

		it("deletes token while preserving others", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token-1");
			store.setToken("https://staging.coder.com", "token-2");

			store.deleteToken("dev.coder.com");

			expect(store.getToken("dev.coder.com")).toBeUndefined();
			expect(store.getToken("staging.coder.com")).toBe("token-2");
		});

		it("deletes entire credential when last token is removed", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token-1");
			store.deleteToken("dev.coder.com");
			expect(store.getToken("dev.coder.com")).toBeUndefined();
			// OS keyring entry itself should be cleaned up, not left as empty JSON
			expect(mockEntry.hasCredential()).toBe(false);
		});

		it("handles delete of non-existent deployment gracefully", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token-1");
			store.deleteToken("unknown.coder.com");
			expect(store.getToken("dev.coder.com")).toBe("token-1");
		});

		it("strips URL path and protocol, keeping only host", () => {
			const { store } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com/some/path", "my-token");
			expect(store.getToken("dev.coder.com")).toBe("my-token");
		});

		it("matches safeHostname to map key with port", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com:3000", "my-token");
			// safeHostname (port stripped) finds the entry stored with port
			expect(store.getToken("dev.coder.com")).toBe("my-token");
			// Used the hostname + port should also work
			expect(store.getToken("dev.coder.com:3000")).toBe("my-token");

			store.deleteToken("dev.coder.com");
			expect(store.getToken("dev.coder.com")).toBeUndefined();
			expect(mockEntry.hasCredential()).toBe(false);
		});
	});

	describe("platform encoding", () => {
		it("macOS: base64-encoded JSON via password", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token");
			const decoded = JSON.parse(
				Buffer.from(mockEntry.getRawPassword()!, "base64").toString("utf-8"),
			);
			expect(decoded).toEqual({
				"dev.coder.com": { coder_url: "dev.coder.com", api_token: "token" },
			});
			// Secret must be untouched; reading uses getPassword, not getSecret.
			expect(mockEntry.getRawSecret()).toBeNull();
			expect(store.getToken("dev.coder.com")).toBe("token");
		});

		it("macOS: returns undefined for corrupted credential", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com", "token");
			mockEntry
				.factory()
				.setPassword(Buffer.from("not-valid-json").toString("base64"));
			expect(store.getToken("dev.coder.com")).toBeUndefined();
		});

		it("Windows: raw UTF-8 JSON via secret", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("win32");
			store.setToken("https://dev.coder.com", "token");
			const decoded = JSON.parse(
				Buffer.from(mockEntry.getRawSecret()!).toString("utf-8"),
			);
			expect(decoded).toEqual({
				"dev.coder.com": { coder_url: "dev.coder.com", api_token: "token" },
			});
			// Password must be untouched; reading uses getSecret, not getPassword.
			expect(mockEntry.getRawPassword()).toBeNull();
			expect(store.getToken("dev.coder.com")).toBe("token");
		});

		it("Windows: returns undefined for corrupted credential", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("win32");
			store.setToken("https://dev.coder.com", "token");
			mockEntry.factory().setSecret(Buffer.from("not-valid-json"));
			expect(store.getToken("dev.coder.com")).toBeUndefined();
		});

		it("preserves port in map key for CLI compatibility", () => {
			const { store, mockEntry } = createTestContext();
			stubPlatform("darwin");
			store.setToken("https://dev.coder.com:8080", "my-token");
			const decoded = JSON.parse(
				Buffer.from(mockEntry.getRawPassword()!, "base64").toString("utf-8"),
			);
			expect(decoded).toEqual({
				"dev.coder.com:8080": {
					coder_url: "dev.coder.com:8080",
					api_token: "my-token",
				},
			});
		});

		it("throws on unsupported platform", () => {
			const { store } = createTestContext();
			stubPlatform("linux");
			const msg = "Keyring is not supported on linux";
			expect(() => store.setToken("https://dev.coder.com", "t")).toThrow(msg);
			expect(() => store.getToken("dev.coder.com")).toThrow(msg);
			expect(() => store.deleteToken("dev.coder.com")).toThrow(msg);
		});
	});
});
