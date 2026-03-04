import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isKeyringEnabled } from "@/cliConfig";
import {
	CliCredentialManager,
	isKeyringSupported,
	type BinaryResolver,
} from "@/core/cliCredentialManager";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("@/cliConfig", () => ({
	isKeyringEnabled: vi.fn().mockReturnValue(false),
}));

const TEST_BIN = "/usr/bin/coder";
const TEST_URL = "https://dev.coder.com";

function stubExecFile(result: { stdout?: string } | { error: string }) {
	vi.mocked(execFile).mockImplementation(
		(_cmd, _args, _opts, callback?: unknown) => {
			const cb =
				typeof _opts === "function"
					? (_opts as (err: Error | null, result?: { stdout: string }) => void)
					: (callback as
							| ((err: Error | null, result?: { stdout: string }) => void)
							| undefined);
			if (cb) {
				if ("error" in result) {
					cb(new Error(result.error));
				} else {
					cb(null, { stdout: result.stdout ?? "" });
				}
			}
			return {} as ReturnType<typeof execFile>;
		},
	);
}

function lastExecArgs(): {
	bin: string;
	args: string[];
	env: NodeJS.ProcessEnv;
} {
	const call = vi.mocked(execFile).mock.calls[0];
	return {
		bin: call[0],
		args: call[1] as string[],
		env: (call[2] as { env: NodeJS.ProcessEnv }).env,
	};
}

function successResolver(): BinaryResolver {
	return vi.fn().mockResolvedValue(TEST_BIN) as unknown as BinaryResolver;
}

function failingResolver(): BinaryResolver {
	return vi
		.fn()
		.mockRejectedValue(new Error("no binary")) as unknown as BinaryResolver;
}

const configs = { get: vi.fn().mockReturnValue(undefined) };

const configWithHeaders = {
	get: vi.fn((key: string) =>
		key === "coder.headerCommand" ? "my-header-cmd" : undefined,
	),
};

function setup(resolver?: BinaryResolver) {
	const r = resolver ?? successResolver();
	return {
		resolver: r,
		manager: new CliCredentialManager(createMockLogger(), r),
	};
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
		vi.stubGlobal("process", { ...process, platform });
		expect(isKeyringSupported()).toBe(expected);
	});
});

describe("CliCredentialManager", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("storeToken", () => {
		it("resolves binary and invokes coder login", async () => {
			stubExecFile({ stdout: "" });
			const { manager, resolver } = setup();

			await manager.storeToken(TEST_URL, "my-secret-token", configs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const exec = lastExecArgs();
			expect(exec.bin).toBe(TEST_BIN);
			expect(exec.args).toEqual(["login", "--use-token-as-session", TEST_URL]);
			// Token must only appear in env, never in args
			expect(exec.env.CODER_SESSION_TOKEN).toBe("my-secret-token");
			expect(exec.args).not.toContain("my-secret-token");
		});

		it("throws when CLI exec fails", async () => {
			stubExecFile({ error: "login failed" });
			const { manager } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("login failed");
		});

		it("throws when binary resolver fails", async () => {
			const { manager } = setup(failingResolver());

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("no binary");
			expect(execFile).not.toHaveBeenCalled();
		});

		it("forwards header command args", async () => {
			stubExecFile({ stdout: "" });
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "token", configWithHeaders);

			expect(lastExecArgs().args).toContain("--header-command");
		});
	});

	describe("readToken", () => {
		it("returns trimmed token from CLI stdout", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "  my-token\n" });
			const { manager, resolver } = setup();

			const token = await manager.readToken(TEST_URL, configs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			expect(token).toBe("my-token");
			expect(lastExecArgs().args).toEqual([
				"login",
				"token",
				"--url",
				TEST_URL,
			]);
		});

		it("returns undefined on whitespace-only stdout", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "  \n" });
			const { manager } = setup();
			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
		});

		it("returns undefined on CLI error", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ error: "no token found" });
			const { manager } = setup();
			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
		});

		it("returns undefined when binary resolver fails", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			const { manager } = setup(failingResolver());

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("skips CLI when keyring is disabled", async () => {
			stubExecFile({ stdout: "my-token" });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});
	});

	describe("deleteToken", () => {
		it("resolves binary and invokes coder logout", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager, resolver } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const exec = lastExecArgs();
			expect(exec.bin).toBe(TEST_BIN);
			expect(exec.args).toEqual(["logout", "--url", TEST_URL, "--yes"]);
		});

		it("never throws on CLI error", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ error: "logout failed" });
			const { manager } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs),
			).resolves.not.toThrow();
		});

		it("never throws when binary resolver fails", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			const { manager } = setup(failingResolver());

			await expect(
				manager.deleteToken(TEST_URL, configs),
			).resolves.not.toThrow();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("forwards header command args", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configWithHeaders);

			expect(lastExecArgs().args).toContain("--header-command");
		});

		it("skips CLI when keyring is disabled", async () => {
			stubExecFile({ stdout: "" });
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
		});
	});
});
