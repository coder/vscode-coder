import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	CliCredentialManager,
	isKeyringSupported,
	type BinaryResolver,
} from "@/core/cliCredentialManager";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

function stubPlatform(platform: string) {
	vi.stubGlobal("process", { ...process, platform });
}

function mockExecFileSuccess(stdout = "") {
	vi.mocked(execFile).mockImplementation(
		(_cmd, _args, _opts, callback?: unknown) => {
			// promisify(execFile) calls execFile with a callback as last argument
			const cb =
				typeof _opts === "function"
					? (_opts as (err: Error | null, result: { stdout: string }) => void)
					: (callback as
							| ((err: Error | null, result: { stdout: string }) => void)
							| undefined);
			if (cb) {
				cb(null, { stdout });
			}
			return {} as ReturnType<typeof execFile>;
		},
	);
}

function mockExecFileFailure(message: string) {
	vi.mocked(execFile).mockImplementation(
		(_cmd, _args, _opts, callback?: unknown) => {
			const cb =
				typeof _opts === "function"
					? (_opts as (err: Error | null) => void)
					: (callback as ((err: Error | null) => void) | undefined);
			if (cb) {
				cb(new Error(message));
			}
			return {} as ReturnType<typeof execFile>;
		},
	);
}

const mockConfigs = {
	get: vi.fn().mockReturnValue(undefined),
};

const TEST_BIN = "/usr/bin/coder";
const TEST_URL = "https://dev.coder.com";

function createSuccessResolver(): BinaryResolver {
	return vi.fn().mockResolvedValue(TEST_BIN) as unknown as BinaryResolver;
}

function createFailingResolver(): BinaryResolver {
	return vi
		.fn()
		.mockRejectedValue(new Error("no binary")) as unknown as BinaryResolver;
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

describe("CliCredentialManager", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("storeToken", () => {
		it("passes token via CODER_SESSION_TOKEN env var", async () => {
			mockExecFileSuccess();
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await manager.storeToken(
				TEST_BIN,
				TEST_URL,
				"my-secret-token",
				mockConfigs,
			);

			expect(execFile).toHaveBeenCalledWith(
				TEST_BIN,
				["login", "--use-token-as-session", TEST_URL],
				expect.objectContaining({
					env: expect.objectContaining({
						CODER_SESSION_TOKEN: "my-secret-token",
					}),
				}),
				expect.any(Function),
			);
		});

		it("never passes token in args", async () => {
			mockExecFileSuccess();
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await manager.storeToken(
				TEST_BIN,
				TEST_URL,
				"my-secret-token",
				mockConfigs,
			);

			const args = vi.mocked(execFile).mock.calls[0][1] as string[];
			expect(args).not.toContain("my-secret-token");
		});

		it("throws when CLI fails", async () => {
			mockExecFileFailure("login failed");
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await expect(
				manager.storeToken(TEST_BIN, TEST_URL, "token", mockConfigs),
			).rejects.toThrow("login failed");
		});

		it("includes header args when header command is set", async () => {
			mockExecFileSuccess();
			const configWithHeaders = {
				get: vi.fn((key: string) =>
					key === "coder.headerCommand" ? "my-header-cmd" : undefined,
				),
			};
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await manager.storeToken(TEST_BIN, TEST_URL, "token", configWithHeaders);

			const args = vi.mocked(execFile).mock.calls[0][1] as string[];
			expect(args).toContain("--header-command");
		});
	});

	describe("readToken", () => {
		it("resolves binary and returns trimmed stdout", async () => {
			mockExecFileSuccess("  my-token\n");
			const resolver = createSuccessResolver();
			const manager = new CliCredentialManager(createMockLogger(), resolver);

			const token = await manager.readToken(TEST_URL, mockConfigs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			expect(token).toBe("my-token");
		});

		it("returns undefined on empty stdout", async () => {
			mockExecFileSuccess("  \n");
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			const token = await manager.readToken(TEST_URL, mockConfigs);

			expect(token).toBeUndefined();
		});

		it("returns undefined on CLI error", async () => {
			mockExecFileFailure("no token found");
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			const token = await manager.readToken(TEST_URL, mockConfigs);

			expect(token).toBeUndefined();
		});

		it("returns undefined when binary resolver fails", async () => {
			const manager = new CliCredentialManager(
				createMockLogger(),
				createFailingResolver(),
			);

			const token = await manager.readToken(TEST_URL, mockConfigs);

			expect(token).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("passes correct args", async () => {
			mockExecFileSuccess("token");
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await manager.readToken(TEST_URL, mockConfigs);

			const call = vi.mocked(execFile).mock.calls[0];
			expect(call[0]).toBe(TEST_BIN);
			expect(call[1]).toEqual(["login", "token", "--url", TEST_URL]);
		});
	});

	describe("deleteToken", () => {
		it("resolves binary and runs coder logout", async () => {
			mockExecFileSuccess();
			const resolver = createSuccessResolver();
			const manager = new CliCredentialManager(createMockLogger(), resolver);

			await manager.deleteToken(TEST_URL, mockConfigs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const call = vi.mocked(execFile).mock.calls[0];
			expect(call[0]).toBe(TEST_BIN);
			expect(call[1]).toEqual(["logout", "--url", TEST_URL, "--yes"]);
		});

		it("does not throw when CLI fails", async () => {
			mockExecFileFailure("logout failed");
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await expect(
				manager.deleteToken(TEST_URL, mockConfigs),
			).resolves.not.toThrow();
		});

		it("does not throw when binary resolver fails", async () => {
			const manager = new CliCredentialManager(
				createMockLogger(),
				createFailingResolver(),
			);

			await expect(
				manager.deleteToken(TEST_URL, mockConfigs),
			).resolves.not.toThrow();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("includes header args when header command is set", async () => {
			mockExecFileSuccess();
			const configWithHeaders = {
				get: vi.fn((key: string) =>
					key === "coder.headerCommand" ? "my-header-cmd" : undefined,
				),
			};
			const manager = new CliCredentialManager(
				createMockLogger(),
				createSuccessResolver(),
			);

			await manager.deleteToken(TEST_URL, configWithHeaders);

			const args = vi.mocked(execFile).mock.calls[0][1] as string[];
			expect(args).toContain("--header-command");
		});
	});
});
