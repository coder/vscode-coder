import { fs as memfs, vol } from "memfs";
import { execFile } from "node:child_process";
import * as os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	CliCredentialManager,
	isKeyringSupported,
	type BinaryResolver,
} from "@/core/cliCredentialManager";
import * as cliExec from "@/core/cliExec";
import { PathResolver } from "@/core/pathResolver";
import { isKeyringEnabled } from "@/settings/cli";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as nodeFs from "node:fs";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:os");

vi.mock("@/settings/cli", () => ({
	isKeyringEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("@/core/cliExec", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliExec")>("@/core/cliExec");
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
	return vi.fn().mockResolvedValue(TEST_BIN);
}

function failingResolver(): BinaryResolver {
	return vi.fn().mockRejectedValue(new Error("no binary"));
}

const configs = { get: vi.fn().mockReturnValue(undefined) };

const configWithHeaders = {
	get: vi.fn((key: string) =>
		key === "coder.headerCommand" ? "my-header-cmd" : undefined,
	),
};

const TEST_PATH_RESOLVER = new PathResolver("/mock/base", "/mock/log");
const CRED_DIR = "/mock/base/dev.coder.com";
const CUSTOM_CRED_DIR = "/custom/coderv2";

function credentialPaths(dir = CRED_DIR) {
	return {
		url: `${dir}/url`,
		session: `${dir}/session`,
	};
}

function writeCredentialFiles(
	url: string,
	token: string,
	dir = CRED_DIR,
): void {
	const paths = credentialPaths(dir);
	vol.mkdirSync(dir, { recursive: true });
	memfs.writeFileSync(paths.url, url);
	memfs.writeFileSync(paths.session, token);
}

function readCredentialFiles(dir = CRED_DIR) {
	const paths = credentialPaths(dir);
	return {
		url: memfs.readFileSync(paths.url, "utf8"),
		session: memfs.readFileSync(paths.session, "utf8"),
	};
}

function credentialFilesExist(dir = CRED_DIR): boolean {
	const paths = credentialPaths(dir);
	return memfs.existsSync(paths.url) || memfs.existsSync(paths.session);
}

function useCustomGlobalConfig(): void {
	new MockConfigurationProvider().set("coder.globalConfig", CUSTOM_CRED_DIR);
}

function setup(resolver?: BinaryResolver) {
	const r = resolver ?? successResolver();
	const sink = new TestSink();
	return {
		resolver: r,
		sink,
		manager: new CliCredentialManager(
			createMockLogger(),
			r,
			TEST_PATH_RESOLVER,
			createTestTelemetryService(sink),
		),
	};
}

describe("isKeyringSupported", () => {
	it.each([
		{ platform: "darwin", expected: true },
		{ platform: "win32", expected: true },
		{ platform: "linux", expected: false },
		{ platform: "freebsd", expected: false },
	])("returns $expected for $platform", ({ platform, expected }) => {
		vi.mocked(os.platform).mockReturnValue(platform as NodeJS.Platform);
		expect(isKeyringSupported()).toBe(expected);
	});
});

describe("CliCredentialManager", () => {
	beforeEach(() => {
		new MockConfigurationProvider();
		vi.clearAllMocks();
		vol.reset();
		vi.mocked(isKeyringEnabled).mockReturnValue(false);
		vi.mocked(cliExec.version).mockResolvedValue("2.31.0");
	});

	describe("storeToken", () => {
		it("writes files when keyring is disabled", async () => {
			const { manager, sink } = setup();

			await expect(
				manager.storeToken(TEST_URL, "my-token", configs),
			).resolves.toBeUndefined();

			expect(execFile).not.toHaveBeenCalled();
			expect(readCredentialFiles()).toStrictEqual({
				url: TEST_URL,
				session: "my-token",
			});
			expect(sink.expectOne("auth.credential.store")).toMatchObject({
				properties: {
					category: "file",
					keyring_enabled: "false",
					result: "success",
				},
			});
		});

		it("resolves binary and invokes coder login when keyring enabled", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager, resolver, sink } = setup();

			await expect(
				manager.storeToken(TEST_URL, "my-secret-token", configs),
			).resolves.toBeUndefined();

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const exec = lastExecArgs();
			expect(exec.bin).toBe(TEST_BIN);
			expect(exec.args).toEqual(["login", "--use-token-as-session", TEST_URL]);
			// Token must only appear in env, never in args
			expect(exec.env.CODER_SESSION_TOKEN).toBe("my-secret-token");
			expect(exec.args).not.toContain("my-secret-token");
			expect(sink.expectOne("auth.credential.store")).toMatchObject({
				properties: {
					category: "keyring",
					keyring_enabled: "true",
					result: "success",
				},
			});
		});

		it("writes files under configured global config when keyring is disabled", async () => {
			useCustomGlobalConfig();
			const { manager } = setup();

			await expect(
				manager.storeToken(TEST_URL, "my-token", configs),
			).resolves.toBeUndefined();

			expect(readCredentialFiles(CUSTOM_CRED_DIR)).toStrictEqual({
				url: TEST_URL,
				session: "my-token",
			});
		});

		it("falls back to files when CLI version too old", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			vi.mocked(cliExec.version).mockResolvedValueOnce("2.28.0");
			const { manager } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).resolves.toBeUndefined();

			expect(execFile).not.toHaveBeenCalled();
			expect(readCredentialFiles()).toStrictEqual({
				url: TEST_URL,
				session: "token",
			});
		});

		it("throws when CLI exec fails", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ error: "login failed" });
			const { manager, sink } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("Credential CLI operation failed");
			expect(sink.expectOne("auth.credential.store")).toMatchObject({
				properties: {
					"error.type": "cli",
					result: "error",
				},
			});
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

			await manager.storeToken(TEST_URL, "token", configs, {
				signal: ac.signal,
			});

			expect(lastExecArgs().signal).toBe(ac.signal);
		});

		it("rejects with AbortError when signal is pre-aborted", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFileAbortable();
			const { manager, sink } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs, {
					signal: AbortSignal.abort(),
				}),
			).rejects.toThrow("The operation was aborted");
			const event = sink.expectOne("auth.credential.store");
			expect(event).toMatchObject({
				properties: { result: "aborted" },
			});
			expect(event.properties["error.type"]).toBeUndefined();
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

		it("reads files when keyring is disabled", async () => {
			writeCredentialFiles(TEST_URL, "file-token");
			stubExecFile({ stdout: "my-token" });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBe("file-token");
			expect(execFile).not.toHaveBeenCalled();
		});

		it("reads files under configured global config when keyring is disabled", async () => {
			useCustomGlobalConfig();
			writeCredentialFiles(
				`${TEST_URL}\n`,
				"custom-file-token\n",
				CUSTOM_CRED_DIR,
			);
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBe(
				"custom-file-token",
			);
			expect(execFile).not.toHaveBeenCalled();
		});

		it("does not read files when keyring token read is unsupported", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			vi.mocked(cliExec.version).mockResolvedValueOnce("2.30.0");
			writeCredentialFiles(TEST_URL, "file-token");
			const { manager, resolver } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			expect(execFile).not.toHaveBeenCalled();
		});

		it("reads files when keyring is enabled but unsupported by the CLI", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			vi.mocked(cliExec.version).mockResolvedValueOnce("2.28.0");
			writeCredentialFiles(TEST_URL, "file-token");
			const { manager, resolver } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBe("file-token");
			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			expect(execFile).not.toHaveBeenCalled();
		});

		it("does not read files for a different URL", async () => {
			writeCredentialFiles("https://other.coder.com", "file-token");
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});

		it("returns undefined when CLI version too old for token read", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			// 2.30 supports keyringAuth but not keyringTokenRead (requires 2.31+)
			vi.mocked(cliExec.version).mockResolvedValueOnce("2.30.0");
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

		it("passes signal through to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "token" });
			const { manager } = setup();
			const ac = new AbortController();

			await manager.readToken(TEST_URL, configs, { signal: ac.signal });

			expect(lastExecArgs().signal).toBe(ac.signal);
		});

		it("throws AbortError when signal is aborted", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFileAbortable();
			const { manager } = setup();

			await expect(
				manager.readToken(TEST_URL, configs, {
					signal: AbortSignal.abort(),
				}),
			).rejects.toThrow("The operation was aborted");
		});
	});

	describe("deleteToken", () => {
		it("deletes files and invokes coder logout when keyring enabled", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager, resolver, sink } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(resolver).toHaveBeenCalledWith(TEST_URL);
			const exec = lastExecArgs();
			expect(exec.bin).toBe(TEST_BIN);
			expect(exec.args).toEqual(["logout", "--url", TEST_URL, "--yes"]);
			expect(credentialFilesExist()).toBe(false);
			expect(sink.expectOne("auth.credential.clear")).toMatchObject({
				properties: {
					category: "keyring",
					keyring_enabled: "true",
					result: "success",
				},
			});
		});

		it("deletes files even when keyring is disabled", async () => {
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(credentialFilesExist()).toBe(false);
		});

		it("deletes files under configured global config", async () => {
			useCustomGlobalConfig();
			writeCredentialFiles(TEST_URL, "old-token", CUSTOM_CRED_DIR);
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(credentialFilesExist(CUSTOM_CRED_DIR)).toBe(false);
		});

		it("never throws on CLI error", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ error: "logout failed" });
			const { manager, sink } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs),
			).resolves.not.toThrow();
			expect(sink.expectOne("auth.credential.clear")).toMatchObject({
				properties: {
					"error.type": "cli",
					result: "error",
				},
			});
		});

		it("never throws when binary resolver fails", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			const { manager, sink } = setup(failingResolver());

			await expect(
				manager.deleteToken(TEST_URL, configs),
			).resolves.toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
			expect(sink.expectOne("auth.credential.clear")).toMatchObject({
				properties: {
					category: "keyring",
					"error.type": "binary",
					result: "error",
				},
			});
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
			vi.mocked(cliExec.version).mockResolvedValueOnce("2.28.0");
			stubExecFile({ stdout: "" });
			writeCredentialFiles(TEST_URL, "old-token");
			const { manager } = setup();

			await manager.deleteToken(TEST_URL, configs);

			expect(execFile).not.toHaveBeenCalled();
			expect(credentialFilesExist()).toBe(false);
		});

		it("passes signal through to execFile", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFile({ stdout: "" });
			const { manager } = setup();
			const ac = new AbortController();

			await manager.deleteToken(TEST_URL, configs, { signal: ac.signal });

			expect(lastExecArgs().signal).toBe(ac.signal);
		});

		it("throws AbortError when signal is aborted", async () => {
			vi.mocked(isKeyringEnabled).mockReturnValue(true);
			stubExecFileAbortable();
			const { manager, sink } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs, {
					signal: AbortSignal.abort(),
				}),
			).rejects.toThrow("The operation was aborted");
			const event = sink.expectOne("auth.credential.clear");
			expect(event).toMatchObject({
				properties: { result: "aborted" },
			});
			expect(event.properties["error.type"]).toBeUndefined();
		});
	});
});
