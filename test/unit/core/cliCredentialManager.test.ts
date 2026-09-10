import { fs as memfs, vol } from "memfs";
import { execFile } from "node:child_process";
import * as os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	CliCredentialManager,
	type BinaryResolver,
} from "@/core/cliCredentialManager";
import * as cliExec from "@/core/cliExec";
import { PathResolver } from "@/core/pathResolver";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as nodeFs from "node:fs";

import type { SessionAuth } from "@/core/secretsManager";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

vi.mock("node:os");

vi.mock("@/core/cliExec", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliExec")>("@/core/cliExec");
	return { ...actual, version: vi.fn() };
});

vi.mock("fs/promises", async () => {
	const memfs: { fs: typeof nodeFs } = await vi.importActual("memfs");
	return { ...memfs.fs.promises, default: memfs.fs.promises };
});

const TEST_BIN = "/usr/bin/coder";
const TEST_URL = "https://dev.coder.com";
const PATH_RESOLVER = new PathResolver("/mock/base", "/mock/log");
// Built with path.join so it matches getGlobalConfigDir on Windows too.
const CRED_DIR = path.join("/mock/base", "dev.coder.com");
const USER_DIR = "/custom/coderv2";

const PRIVATE_FLAGS = [
	"--global-config",
	CRED_DIR,
	"--url",
	TEST_URL,
	"--use-keyring=false",
];
const KEYRING_FLAGS = ["--url", TEST_URL, "--use-keyring=true"];
const USER_DIR_FLAGS = [
	`--global-config=${USER_DIR}`,
	"--url",
	TEST_URL,
	"--use-keyring=false",
];

const EXTENSION_SESSION: SessionAuth = {
	url: TEST_URL,
	token: "my-token",
	tokenSource: "extension",
};
const CLI_SESSION: SessionAuth = { ...EXTENSION_SESSION, tokenSource: "cli" };

type ExecResult = string | Error;
type ExecCallback = (err: Error | null, result?: { stdout: string }) => void;
interface ExecOptions {
	env?: NodeJS.ProcessEnv;
	timeout?: number;
	signal?: AbortSignal;
}

/** Answers each subcommand with stdout or a failure; "abort" waits for the signal. */
function stubExecFile(
	results:
		| { login?: ExecResult; token?: ExecResult; logout?: ExecResult }
		| "abort" = {},
) {
	vi.mocked(execFile).mockImplementation(((
		_bin: string,
		args: string[],
		opts: ExecOptions,
		cb: ExecCallback,
	) => {
		if (results === "abort") {
			const err = new Error("The operation was aborted");
			err.name = "AbortError";
			if (opts.signal?.aborted) {
				cb(err);
			} else {
				opts.signal?.addEventListener("abort", () => cb(err));
			}
			return;
		}
		const result = args.includes("token")
			? results.token
			: args.includes("logout")
				? results.logout
				: results.login;
		if (result instanceof Error) {
			cb(result);
		} else {
			cb(null, { stdout: result ?? "" });
		}
	}) as unknown as typeof execFile);
}

const execCalls = () =>
	vi.mocked(execFile).mock.calls.map((call) => call[1] as string[]);
const execOptions = () => vi.mocked(execFile).mock.calls[0][2] as ExecOptions;

/** A configs fake that honors defaultValue for everything but `values`. */
function configWith(values: Record<string, unknown>) {
	return {
		get: vi.fn((key: string, defaultValue?: unknown) =>
			key in values ? values[key] : defaultValue,
		),
	};
}
const configs = configWith({});
const userDirConfigs = configWith({
	"coder.globalFlags": [`--global-config=${USER_DIR}`],
});

function writeCredentialFiles(): void {
	vol.mkdirSync(CRED_DIR, { recursive: true });
	memfs.writeFileSync(`${CRED_DIR}/url`, TEST_URL);
	memfs.writeFileSync(`${CRED_DIR}/session`, "old-token");
}

const credentialFilesExist = () =>
	memfs.existsSync(`${CRED_DIR}/url`) ||
	memfs.existsSync(`${CRED_DIR}/session`);

const missingBinary = (): BinaryResolver =>
	vi.fn().mockRejectedValue(new Error("no binary"));

function setup(resolver: BinaryResolver = vi.fn().mockResolvedValue(TEST_BIN)) {
	const sink = new TestSink();
	const manager = new CliCredentialManager(
		createMockLogger(),
		resolver,
		PATH_RESOLVER,
		createTestTelemetryService(sink),
	);
	return { sink, manager };
}

describe("CliCredentialManager", () => {
	beforeEach(() => {
		new MockConfigurationProvider();
		vi.clearAllMocks();
		vol.reset();
		vi.stubEnv("CODER_CONFIG_DIR", undefined);
		// Linux: keyring unsupported, so the extension directory is used.
		vi.mocked(os.platform).mockReturnValue("linux");
		vi.mocked(cliExec.version).mockResolvedValue("2.31.0");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	// Store selection is covered by cliConfig.test.ts; this checks the wiring.
	interface Case {
		scenario: string;
		platform: NodeJS.Platform;
		configs: typeof configs;
		expected: string[];
		store: string;
	}

	it.each<Case>([
		{
			scenario: "extension directory when keyring is unsupported",
			platform: "linux",
			configs,
			expected: PRIVATE_FLAGS,
			store: "private",
		},
		{
			scenario: "CLI default store when keyring is enabled",
			platform: "darwin",
			configs,
			expected: KEYRING_FLAGS,
			store: "shared",
		},
		{
			scenario: "user --global-config directory",
			platform: "linux",
			configs: userDirConfigs,
			expected: USER_DIR_FLAGS,
			store: "shared",
		},
	])(
		"targets the $scenario",
		async ({ platform, configs, expected, store }) => {
			vi.mocked(os.platform).mockReturnValue(platform);
			stubExecFile();
			const { manager, sink } = setup();

			await manager.storeToken(TEST_URL, "token", configs);

			expect(execCalls()).toEqual([
				[...expected, "login", "--use-token-as-session", TEST_URL],
			]);
			expect(sink.expectOne("auth.credential.store")).toMatchObject({
				properties: { store, result: "success" },
			});
		},
	);

	describe("storeToken", () => {
		it("passes the token through the environment only", async () => {
			stubExecFile();
			const { manager } = setup();

			await manager.storeToken(TEST_URL, "my-secret-token", configs);

			expect(execOptions().env?.CODER_SESSION_TOKEN).toBe("my-secret-token");
			expect(execCalls()[0]).not.toContain("my-secret-token");
		});

		it("throws a CredentialCliError when the CLI fails", async () => {
			stubExecFile({ login: new Error("login failed") });
			const { manager, sink } = setup();

			await expect(
				manager.storeToken(TEST_URL, "token", configs),
			).rejects.toThrow("Credential CLI operation failed");
			expect(sink.expectOne("auth.credential.store")).toMatchObject({
				properties: { "error.type": "cli", result: "error" },
			});
		});
	});

	describe("readToken", () => {
		it("returns the trimmed token from the CLI store", async () => {
			vi.mocked(os.platform).mockReturnValue("darwin");
			stubExecFile({ token: "  my-token\n" });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBe("my-token");
			expect(execCalls()).toEqual([[...KEYRING_FLAGS, "login", "token"]]);
		});

		it.each([
			{ scenario: "whitespace-only stdout", token: "  \n" },
			{ scenario: "a CLI error", token: new Error("no token found") },
		])("returns undefined on $scenario", async ({ token }) => {
			stubExecFile({ token });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
		});

		it("returns undefined below CLI 2.31 without running the CLI", async () => {
			vi.mocked(cliExec.version).mockResolvedValue("2.30.0");
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});
	});

	describe("deleteToken", () => {
		it.each([
			{ scenario: "a CLI token", session: CLI_SESSION },
			{ scenario: "no session", session: undefined },
		])(
			"logs out of the extension directory even for $scenario",
			async ({ session }) => {
				stubExecFile();
				writeCredentialFiles();
				const { manager, sink } = setup();

				const result = await manager.deleteToken(TEST_URL, configs, session);

				expect(result).toBe(true);
				expect(execCalls()).toEqual([[...PRIVATE_FLAGS, "logout", "--yes"]]);
				expect(credentialFilesExist()).toBe(false);
				expect(sink.expectOne("auth.credential.clear")).toMatchObject({
					properties: { store: "private", result: "success" },
				});
			},
		);

		it("reports a failed logout without throwing", async () => {
			stubExecFile({ logout: new Error("logout failed") });
			const { manager, sink } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs, EXTENSION_SESSION),
			).resolves.toBe(false);
			expect(sink.expectOne("auth.credential.clear")).toMatchObject({
				properties: { "error.type": "cli", result: "error" },
			});
		});

		describe("in a store shared with the CLI", () => {
			beforeEach(() => {
				vi.mocked(os.platform).mockReturnValue("darwin");
			});

			it("logs out when the CLI holds the extension's token", async () => {
				stubExecFile({ token: "my-token\n" });
				writeCredentialFiles();
				const { manager, sink } = setup();

				const result = await manager.deleteToken(
					TEST_URL,
					configs,
					EXTENSION_SESSION,
				);

				expect(result).toBe(true);
				expect(execCalls()).toEqual([
					[...KEYRING_FLAGS, "login", "token"],
					[...KEYRING_FLAGS, "logout", "--yes"],
				]);
				expect(credentialFilesExist()).toBe(false);
				expect(sink.expectOne("auth.credential.clear")).toMatchObject({
					properties: { store: "shared", result: "success" },
				});
			});

			interface Case {
				scenario: string;
				session?: SessionAuth;
				token?: ExecResult;
			}

			it.each<Case>([
				{
					scenario: "the CLI holds another token",
					session: EXTENSION_SESSION,
					token: "someone-elses-token",
				},
				{
					scenario: "the CLI token cannot be read",
					session: EXTENSION_SESSION,
					token: new Error("keychain locked"),
				},
				{ scenario: "the token came from the CLI", session: CLI_SESSION },
				{ scenario: "there is no session", session: undefined },
			])("keeps the CLI session when $scenario", async ({ session, token }) => {
				stubExecFile({ token });
				writeCredentialFiles();
				const { manager } = setup();

				const result = await manager.deleteToken(TEST_URL, configs, session);

				expect(result).toBe(true);
				expect(execCalls().some((args) => args.includes("logout"))).toBe(false);
				expect(credentialFilesExist()).toBe(false);
			});

			it("logs out without verifying below CLI 2.31", async () => {
				vi.mocked(cliExec.version).mockResolvedValue("2.30.0");
				stubExecFile();
				const { manager } = setup();

				const result = await manager.deleteToken(
					TEST_URL,
					configs,
					EXTENSION_SESSION,
				);

				expect(result).toBe(true);
				expect(execCalls()).toEqual([[...KEYRING_FLAGS, "logout", "--yes"]]);
			});

			it("treats a user --global-config directory as shared", async () => {
				vi.mocked(os.platform).mockReturnValue("linux");
				stubExecFile({ token: "my-token" });
				const { manager } = setup();

				const result = await manager.deleteToken(
					TEST_URL,
					userDirConfigs,
					EXTENSION_SESSION,
				);

				expect(result).toBe(true);
				expect(execCalls()).toEqual([
					[...USER_DIR_FLAGS, "login", "token"],
					[...USER_DIR_FLAGS, "logout", "--yes"],
				]);
			});
		});
	});

	describe("every CLI call", () => {
		type Run = (
			manager: CliCredentialManager,
			options: { signal: AbortSignal },
		) => Promise<unknown>;
		const operations: Array<{
			name: string;
			run: Run;
			event?: string;
			onMissingBinary: (result: Promise<unknown>) => Promise<unknown>;
		}> = [
			{
				name: "storeToken",
				run: (m, o) => m.storeToken(TEST_URL, "token", configs, o),
				event: "auth.credential.store",
				onMissingBinary: (r) => expect(r).rejects.toThrow("no binary"),
			},
			{
				name: "readToken",
				run: (m, o) => m.readToken(TEST_URL, configs, o),
				onMissingBinary: (r) => expect(r).resolves.toBeUndefined(),
			},
			{
				name: "deleteToken",
				run: (m, o) => m.deleteToken(TEST_URL, configs, EXTENSION_SESSION, o),
				event: "auth.credential.clear",
				onMissingBinary: (r) => expect(r).resolves.toBe(false),
			},
		];

		it.each(operations)(
			"$name passes the timeout and signal",
			async ({ run }) => {
				stubExecFile({ token: "token" });
				const { manager } = setup();
				const ac = new AbortController();

				await run(manager, { signal: ac.signal });

				expect(execOptions()).toMatchObject({
					timeout: 60_000,
					signal: ac.signal,
				});
			},
		);

		it.each(operations)(
			"$name rethrows AbortError and records the abort",
			async ({ run, event }) => {
				stubExecFile("abort");
				const { manager, sink } = setup();

				await expect(
					run(manager, { signal: AbortSignal.abort() }),
				).rejects.toThrow("The operation was aborted");
				if (event) {
					const span = sink.expectOne(event);
					expect(span.properties).toMatchObject({ result: "aborted" });
					expect(span.properties["error.type"]).toBeUndefined();
				}
			},
		);

		it.each(operations)(
			"$name handles a missing binary without running the CLI",
			async ({ run, event, onMissingBinary }) => {
				const { manager, sink } = setup(missingBinary());

				await onMissingBinary(
					run(manager, { signal: new AbortController().signal }),
				);

				expect(execFile).not.toHaveBeenCalled();
				if (event) {
					expect(sink.expectOne(event).properties).toMatchObject({
						result: "error",
						"error.type": "binary",
					});
				}
			},
		);
	});
});
