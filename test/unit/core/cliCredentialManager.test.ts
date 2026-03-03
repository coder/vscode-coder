import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	CliCredentialManager,
	isKeyringSupported,
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
			const manager = new CliCredentialManager(createMockLogger());

			await manager.storeToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				"my-secret-token",
				mockConfigs,
			);

			expect(execFile).toHaveBeenCalledWith(
				"/usr/bin/coder",
				["login", "--use-token-as-session", "https://dev.coder.com"],
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
			const manager = new CliCredentialManager(createMockLogger());

			await manager.storeToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				"my-secret-token",
				mockConfigs,
			);

			const args = vi.mocked(execFile).mock.calls[0][1] as string[];
			expect(args).not.toContain("my-secret-token");
		});

		it("throws when CLI fails", async () => {
			mockExecFileFailure("login failed");
			const manager = new CliCredentialManager(createMockLogger());

			await expect(
				manager.storeToken(
					"/usr/bin/coder",
					"https://dev.coder.com",
					"token",
					mockConfigs,
				),
			).rejects.toThrow("login failed");
		});

		it("includes header args when header command is set", async () => {
			mockExecFileSuccess();
			const configWithHeaders = {
				get: vi.fn((key: string) =>
					key === "coder.headerCommand" ? "my-header-cmd" : undefined,
				),
			};
			const manager = new CliCredentialManager(createMockLogger());

			await manager.storeToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				"token",
				configWithHeaders,
			);

			const args = vi.mocked(execFile).mock.calls[0][1] as string[];
			expect(args).toContain("--header-command");
		});
	});

	describe("readToken", () => {
		it("returns trimmed stdout", async () => {
			mockExecFileSuccess("  my-token\n");
			const manager = new CliCredentialManager(createMockLogger());

			const token = await manager.readToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				mockConfigs,
			);

			expect(token).toBe("my-token");
		});

		it("returns undefined on empty stdout", async () => {
			mockExecFileSuccess("  \n");
			const manager = new CliCredentialManager(createMockLogger());

			const token = await manager.readToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				mockConfigs,
			);

			expect(token).toBeUndefined();
		});

		it("returns undefined on error", async () => {
			mockExecFileFailure("no token found");
			const manager = new CliCredentialManager(createMockLogger());

			const token = await manager.readToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				mockConfigs,
			);

			expect(token).toBeUndefined();
		});

		it("passes correct args", async () => {
			mockExecFileSuccess("token");
			const manager = new CliCredentialManager(createMockLogger());

			await manager.readToken(
				"/usr/bin/coder",
				"https://dev.coder.com",
				mockConfigs,
			);

			const call = vi.mocked(execFile).mock.calls[0];
			expect(call[0]).toBe("/usr/bin/coder");
			expect(call[1]).toEqual([
				"login",
				"token",
				"--url",
				"https://dev.coder.com",
			]);
		});
	});
});
