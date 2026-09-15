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

const EXTENSION_FLAGS = [
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
		vi.mocked(cliExec.version).mockResolvedValue("2.32.0");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	// Store selection is covered by cliConfig.test.ts; this checks the wiring.
	interface StoreCase {
		scenario: string;
		platform: NodeJS.Platform;
		configs: typeof configs;
		expected: string[];
		store: string;
	}

	it.each<StoreCase>([
		{
			scenario: "extension directory when keyring is unsupported",
			platform: "linux",
			configs,
			expected: EXTENSION_FLAGS,
			store: "extension",
		},
		{
			scenario: "CLI default store when keyring is enabled",
			platform: "darwin",
			configs,
			expected: KEYRING_FLAGS,
			store: "cli",
		},
		{
			scenario: "user --global-config directory",
			platform: "linux",
			configs: userDirConfigs,
			expected: USER_DIR_FLAGS,
			store: "cli",
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

		interface CliErrorCase {
			scenario: string;
			error: Error;
			message: string;
		}

		it.each<CliErrorCase>([
			{
				scenario: "the CLI's stderr",
				error: Object.assign(new Error("Command failed"), {
					stderr: "keychain is locked\n",
				}),
				message: "keychain is locked",
			},
			{
				scenario: "the error message without stderr",
				error: new Error("login failed"),
				message: "login failed",
			},
		])(
			"throws a CredentialCliError carrying $scenario",
			async ({ error, message }) => {
				stubExecFile({ login: error });
				const { manager, sink } = setup();

				await expect(
					manager.storeToken(TEST_URL, "token", configs),
				).rejects.toThrow(message);
				expect(sink.expectOne("auth.credential.store")).toMatchObject({
					properties: { "error.type": "cli", result: "error" },
				});
			},
		);
	});

	describe("readToken", () => {
		it("returns the trimmed token from the CLI store", async () => {
			vi.mocked(os.platform).mockReturnValue("darwin");
			stubExecFile({ token: "  my-token\n" });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBe("my-token");
			expect(execCalls()).toEqual([[...KEYRING_FLAGS, "login", "token"]]);
		});

		interface ReadTokenCase {
			scenario: string;
			token: ExecResult;
		}

		it.each<ReadTokenCase>([
			{ scenario: "whitespace-only stdout", token: "  \n" },
			{ scenario: "a CLI error", token: new Error("no token found") },
		])("returns undefined on $scenario", async ({ token }) => {
			stubExecFile({ token });
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
		});

		it("returns undefined below CLI 2.32 without running the CLI", async () => {
			vi.mocked(cliExec.version).mockResolvedValue("2.31.0");
			const { manager } = setup();

			expect(await manager.readToken(TEST_URL, configs)).toBeUndefined();
			expect(execFile).not.toHaveBeenCalled();
		});
	});

	describe("holdsToken", () => {
		interface HoldsTokenCase {
			scenario: string;
			platform: NodeJS.Platform;
			version?: string;
			cliToken?: string;
			expected: boolean;
		}

		it.each<HoldsTokenCase>([
			{ scenario: "the extension store", platform: "linux", expected: false },
			{
				scenario: "the CLI store holding the token",
				platform: "darwin",
				expected: true,
			},
			{
				scenario: "the CLI store holding another token",
				platform: "darwin",
				cliToken: "other",
				expected: false,
			},
			{
				scenario: "the CLI store below 2.32, which cannot be read",
				platform: "darwin",
				version: "2.31.0",
				cliToken: "other",
				expected: true,
			},
		])(
			"is $expected for $scenario",
			async ({
				platform,
				version = "2.32.0",
				cliToken = "my-token",
				expected,
			}) => {
				vi.mocked(os.platform).mockReturnValue(platform);
				vi.mocked(cliExec.version).mockResolvedValue(version);
				stubExecFile({ token: cliToken });

				expect(
					await setup().manager.holdsToken(TEST_URL, "my-token", configs),
				).toBe(expected);
			},
		);
	});

	interface HasCliStoreCase {
		scenario: string;
		platform: NodeJS.Platform;
		binary: string | undefined;
		expected: boolean;
	}

	it.each<HasCliStoreCase>([
		{
			scenario: "the extension store",
			platform: "linux",
			binary: TEST_BIN,
			expected: false,
		},
		{
			scenario: "the CLI store",
			platform: "darwin",
			binary: TEST_BIN,
			expected: true,
		},
		{
			scenario: "the CLI store without a binary",
			platform: "darwin",
			binary: undefined,
			expected: false,
		},
	])(
		"hasCliStore is $expected for $scenario",
		async ({ platform, binary, expected }) => {
			vi.mocked(os.platform).mockReturnValue(platform);
			const { manager } = setup(vi.fn().mockResolvedValue(binary));

			expect(await manager.hasCliStore(TEST_URL, configs)).toBe(expected);
		},
	);

	describe("deleteToken", () => {
		interface DeleteTokenCase {
			scenario: string;
			platform: NodeJS.Platform;
			signOutCli: boolean;
			logout: string[] | undefined;
			outcome: string;
		}

		it.each<DeleteTokenCase>([
			{
				scenario: "always logs out of the extension store",
				platform: "linux",
				signOutCli: false,
				logout: EXTENSION_FLAGS,
				outcome: "logged_out",
			},
			{
				scenario: "logs out of the CLI store when asked",
				platform: "darwin",
				signOutCli: true,
				logout: KEYRING_FLAGS,
				outcome: "logged_out",
			},
			{
				scenario: "keeps the CLI session unless asked",
				platform: "darwin",
				signOutCli: false,
				logout: undefined,
				outcome: "kept",
			},
		])("$scenario", async ({ platform, signOutCli, logout, outcome }) => {
			vi.mocked(os.platform).mockReturnValue(platform);
			stubExecFile();
			writeCredentialFiles();
			const { manager, sink } = setup();

			const result = await manager.deleteToken(TEST_URL, configs, {
				signOutCli,
			});

			expect(result).toBe(true);
			expect(execCalls()).toEqual(
				logout ? [[...logout, "logout", "--yes"]] : [],
			);
			expect(credentialFilesExist()).toBe(false);
			expect(sink.expectOne("auth.credential.clear").properties).toMatchObject({
				result: "success",
				outcome,
			});
		});

		it("reports a failed logout without throwing", async () => {
			stubExecFile({ logout: new Error("logout failed") });
			const { manager, sink } = setup();

			await expect(
				manager.deleteToken(TEST_URL, configs, { signOutCli: true }),
			).resolves.toBe(false);
			expect(sink.expectOne("auth.credential.clear")).toMatchObject({
				properties: { "error.type": "cli", result: "error" },
			});
		});
	});

	describe("every CLI call", () => {
		type Run = (
			manager: CliCredentialManager,
			options: { signal: AbortSignal },
		) => Promise<unknown>;
		interface Operation {
			name: string;
			run: Run;
			event?: string;
			whenMissing: (result: Promise<unknown>) => Promise<unknown>;
			whenBroken: (result: Promise<unknown>) => Promise<unknown>;
		}
		const operations: Operation[] = [
			{
				name: "storeToken",
				run: (m, o) => m.storeToken(TEST_URL, "token", configs, o),
				event: "auth.credential.store",
				whenMissing: (r) => expect(r).resolves.toBeUndefined(),
				whenBroken: (r) => expect(r).rejects.toThrow("broken"),
			},
			{
				name: "readToken",
				run: (m, o) => m.readToken(TEST_URL, configs, o),
				whenMissing: (r) => expect(r).resolves.toBeUndefined(),
				whenBroken: (r) => expect(r).resolves.toBeUndefined(),
			},
			{
				name: "deleteToken",
				run: (m, o) =>
					m.deleteToken(TEST_URL, configs, { ...o, signOutCli: true }),
				event: "auth.credential.clear",
				whenMissing: (r) => expect(r).resolves.toBe(true),
				whenBroken: (r) => expect(r).resolves.toBe(false),
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
			"$name is skipped when no binary is downloaded",
			async ({ run, event, whenMissing }) => {
				const { manager, sink } = setup(vi.fn().mockResolvedValue(undefined));

				await whenMissing(
					run(manager, { signal: new AbortController().signal }),
				);

				expect(execFile).not.toHaveBeenCalled();
				if (event) {
					expect(sink.expectOne(event).properties).toMatchObject({
						result: "success",
						outcome: "no_binary",
					});
				}
			},
		);

		it.each(operations)(
			"$name reports a binary that cannot be resolved without running the CLI",
			async ({ run, event, whenBroken }) => {
				const { manager, sink } = setup(
					vi.fn().mockRejectedValue(new Error("broken")),
				);

				await whenBroken(
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
