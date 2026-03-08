import { fs as memfs, vol } from "memfs";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isKeyringEnabled } from "@/cliConfig";
import {
	CliCredentialManager,
	isKeyringSupported,
	type BinaryResolver,
} from "@/core/cliCredentialManager";
import * as cliUtils from "@/core/cliUtils";
import { PathResolver } from "@/core/pathResolver";

import { createMockLogger } from "../../mocks/testHelpers";

import type * as nodeFs from "node:fs";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("@/cliConfig", () => ({
	isKeyringEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("@/core/cliUtils", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliUtils")>("@/core/cliUtils");
	return {
		...actual,
		version: vi.fn().mockResolvedValue("2.29.0"),
	};
});

vi.mock("fs/promises", async () => {
	const memfs: { fs: typeof nodeFs } = await vi.importActual("memfs");
	return {
		...memfs.fs.promises,
		default: memfs.fs.promises,
	};
});

const TEST_BIN = "/usr/bin/coder";
const TEST_URL = "https://dev.coder.com";

// promisify(execFile) always calls execFile(bin, args, opts, callback).
// We extract the options from the third positional argument.
interface ExecFileOptions {
	env?: NodeJS.ProcessEnv;
	timeout?: number;
	signal?: AbortSignal;
}

type ExecFileCallback = (
	err: Error | null,
	result?: { stdout: string },
) => void;

function stubExecFile(result: { stdout?: string } | { error: string }) {
	vi.mocked(execFile).mockImplementation(((
		_bin: string,
		_args: string[],
		_opts: ExecFileOptions,
		cb: ExecFileCallback,
	) => {
		if ("error" in result) {
			cb(new Error(result.error));
		} else {
			cb(null, { stdout: result.stdout ?? "" });
		}
	}) as unknown as typeof execFile);
}

function stubExecFileAbortable() {
	vi.mocked(execFile).mockImplementation(((
		_bin: string,
		_args: string[],
		opts: ExecFileOptions,
		cb: ExecFileCallback,
	) => {
		const err = new Error("The operation was aborted");
		err.name = "AbortError";
		if (opts.signal?.aborted) {
			cb(err);
		} else {
			opts.signal?.addEventListener("abort", () => cb(err));
		}
	}) as unknown as typeof execFile);
}

function lastExecArgs() {
	const [bin, args, opts] = vi.mocked(execFile).mock.calls[0] as [
		string,
		readonly string[],
		ExecFileOptions,
		...unknown[],
	];
	return {
		bin,
		args,
		env: opts.env ?? process.env,
		timeout: opts.timeout,
		signal: opts.signal,
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

const TEST_PATH_RESOLVER = new PathResolver("/mock/base", "/mock/log");
const CRED_DIR = "/mock/base/dev.coder.com";
const URL_FILE = `${CRED_DIR}/url`;
const SESSION_FILE = `${CRED_DIR}/session`;

function writeCredentialFiles(url: string, token: string) {
	vol.mkdirSync(CRED_DIR, { recursive: true });
	memfs.writeFileSync(URL_FILE, url);
	memfs.writeFileSync(SESSION_FILE, token);
}

function setup(resolver?: BinaryResolver) {
	const r = resolver ?? successResolver();
	return {
		resolver: r,
		manager: new CliCredentialManager(
			createMockLogger(),
			r,
			TEST_PATH_RESOLVER,
		),
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
	beforeEach(() => {
		vi.clearAllMocks();
		vol.reset();
		vi.mocked(isKeyringEnabled).mockReturnValue(false);
		vi.mocked(cliUtils.version).mockResolvedValue("2.31.0");
	});

	describe("storeToken", () => {
		it("writes files when keyring is disabled", async () => {
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "my-token", configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(memfs.readFileSync(URL_FILE, "utf8")).toBe(TEST_URL);
			expect(memfs.readFileSync(SESSION_FILE, "utf8")).toBe("my-token");
		});

		it("resolves binary and invokes coder login when keyring enabled", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
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

		it("falls back to files when CLI version too old", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			vi.mocked(cliUtils.version).mockResolvedValueOnce("2.28.0");
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "token", configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(memfs.readFileSync(URL_FILE, "utf8")).toBe(TEST_URL);
			expect(memfs.readFileSync(SESSION_FILE, "utf8")).toBe("token");
		});

		it("throws when CLI exec fails", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ error: "login failed" });
			const { manager } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("login failed");
		});

		it("throws when binary resolver fails and keyring enabled", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			const { manager } = setup(failingResolver());

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("no binary");
			expect(execFile).not.toHaveBeenCalled();
		});

		it("forwards header command args", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "token", configWithHeaders);

			expect(lastExecArgs().args).toContain("--header-command");
		});

		it("passes timeout to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "token", configs);

			expect(lastExecArgs().timeout).toBe(60_000);
		});

		it("passes signal through to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();
			const ac = new AbortController();

			await manager.storeToken(TEST_URL, "token", configs, ac.signal);

			expect(lastExecArgs().signal).toBe(ac.signal);
		});

		it("rejects with AbortError when signal is pre-aborted", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFileAbortable();
			const { manager } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs, AbortSignal.abort()),
			).rejects.toThrow("The operation was aborted");
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

		it("returns undefined when CLI version too old for token read", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			// 2.30 supports keyringAuth but not keyringTokenRead (requires 2.31+)
			vi.mocked(cliUtils.version).mockResolvedValueOnce("2.30.0");
			stubExecFile({ stdout: "my-token" });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("passes timeout to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "token" });
			const { manager } = setup();

			await manager.readToken(TEST_URL, configs);

			expect(lastExecArgs().timeout).toBe(60_000);
		});
	});

	describe("deleteToken", () => {
		it("deletes files and invokes coder logout when keyring enabled", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager, resolver } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const exec = lastExecArgs();
			expect(exec.bin).toBe(TEST_BIN);
			expect(exec.args).toEqual(["logout", "--url", TEST_URL, "--yes"]);
			expect(memfs.existsSync(URL_FILE)).toBe(false);
			expect(memfs.existsSync(SESSION_FILE)).toBe(false);
		});

		it("deletes files even when keyring is disabled", async () => {
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(memfs.existsSync(URL_FILE)).toBe(false);
			expect(memfs.existsSync(SESSION_FILE)).toBe(false);
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

		it("skips keyring when CLI version too old", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			vi.mocked(cliUtils.version).mockResolvedValueOnce("2.28.0");
			stubExecFile({ stdout: "" });
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(memfs.existsSync(URL_FILE)).toBe(false);
			expect(memfs.existsSync(SESSION_FILE)).toBe(false);
		});

		it("passes signal through to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();
			const ac = new AbortController();

			await manager.deleteToken(TEST_URL, configs, ac.signal);

			expect(lastExecArgs().signal).toBe(ac.signal);
		});

		it("does not throw when signal is aborted", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFileAbortable();
			const { manager } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs, AbortSignal.abort()),
			).resolves.not.toThrow();
		});
	});
});
