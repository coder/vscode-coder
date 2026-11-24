import { Api } from "coder/site/src/api/api";
import { vol } from "memfs";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { version as cliVersion } from "@/cli/cliExec";
import { parseRemoteAuthority } from "@/remote/authority";
import {
	buildSshProxyCommand,
	ConnectionSetup,
} from "@/remote/connectionSetup";
import { getHomeSshConfigPath } from "@/remote/sshConfig";
import { resolveSshProperties } from "@/remote/sshSupport";
import { MementoManager } from "@/storage/mementoManager";
import { PathResolver } from "@/storage/pathResolver";

import {
	createMockLogger,
	createMockServiceContainer,
	flush,
	InMemoryMemento,
	MockConfigurationProvider,
	MockUserInteraction,
	useEditor,
} from "../../mocks/testHelpers";
import { isWindows } from "../../utils/platform";

import type { CliManager } from "@/cli/cliManager";
import type { Logger } from "@/logging/logger";
import type { CliAuth } from "@/settings/cli";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("@/remote/windowsAcl", () => ({
	createManagedPermissions: () => undefined,
}));
vi.mock(import("@/cli/cliExec"), async (importOriginal) => ({
	...(await importOriginal()),
	version: vi.fn(),
}));
vi.mock(import("@/remote/sshSupport"), async (importOriginal) => ({
	...(await importOriginal()),
	resolveSshProperties: vi.fn(),
}));
vi.mock(import("@/remote/sshConfig"), async (importOriginal) => ({
	...(await importOriginal()),
	getHomeSshConfigPath: vi.fn(),
}));

const SAFE_HOSTNAME = "coder.example.com";
const REMOTE_AUTHORITY =
	"ssh-remote+coder-vscode.coder.example.com--testuser--test-workspace.main";
const CLI_AUTH: CliAuth = {
	store: "extension",
	url: "https://coder.example.com",
	configDir: "/mock/global",
	useKeyring: false,
	refuseRedirects: false,
};

function createConnectionSetup(logger: Logger = createMockLogger()) {
	new MockConfigurationProvider();
	const userInteraction = new MockUserInteraction();
	const serviceContainer = createMockServiceContainer({
		logger,
		pathResolver: new PathResolver("/mock/global", "/mock/log"),
		mementoManager: new MementoManager(new InMemoryMemento()),
		cliManager: {} as CliManager,
	});
	return {
		connectionSetup: new ConnectionSetup(
			serviceContainer,
			vscode.ExtensionMode.Production,
		),
		userInteraction,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	vol.reset();
});

interface SshFlagsCase {
	name: string;
	flags?: string[];
	expected: string;
}

/** Drops the platform-specific network info path. */
const elideNetworkInfoDir = (command: string) =>
	command.replace(/--network-info-dir \S+/, "--network-info-dir <dir>");

describe("session app", () => {
	function mockClient(
		version = "2.38.0",
		sshConfigOptions: Record<string, string> = {},
	) {
		const client = new Api();
		vi.spyOn(client, "getBuildInfo").mockResolvedValue({
			version,
			external_url: "",
			dashboard_url: "",
			telemetry: false,
			workspace_proxy: false,
			agent_api_version: "",
			provisioner_api_version: "",
			upgrade_message: "",
			deployment_id: "",
		});
		vi.spyOn(client, "getDeploymentSSHConfig").mockResolvedValue({
			hostname_prefix: "",
			hostname_suffix: "",
			ssh_config_options: sshConfigOptions,
		});
		return client;
	}

	async function checkCompatibility(cli: string | Error, server: string) {
		const { connectionSetup } = createConnectionSetup();
		if (cli instanceof Error) {
			vi.mocked(cliVersion).mockRejectedValue(cli);
		} else {
			vi.mocked(cliVersion).mockResolvedValue(cli);
		}
		return connectionSetup.checkCompatibility({
			workspaceClient: mockClient(server),
			binaryPath: "/mock/coder",
			baseUrl: CLI_AUTH.url,
			safeHostname: SAFE_HOSTNAME,
		});
	}

	it.each([
		["cursor", "2.38.0", "2.38.0", "cursor"],
		["future-editor-next", "2.38.0", "2.38.0", "future-editor-next"],
		["", "2.38.0", "2.38.0", "vscode"],
		["cursor", "2.37.99", "2.38.0", "vscode"],
		["cursor", "2.38.0", "2.37.99", "vscode"],
		["cursor", "invalid", "2.38.0", "vscode"],
		["cursor", "2.38.0", "invalid", "vscode"],
	])(
		"selects %s with CLI %s and server %s",
		async (scheme, cli, server, expected) => {
			useEditor(scheme);
			expect((await checkCompatibility(cli, server)).sessionApp).toBe(expected);
		},
	);

	it("does not hide an unsupported CLI behind the version-probe fallback", async () => {
		await expect(checkCompatibility("2.28.9", "2.38.0")).rejects.toThrow(
			"Your Coder CLI is version 2.28.9. This extension requires Coder CLI 2.29.0 or newer. Upgrade your CLI to continue.",
		);
	});

	it.each([new Error("unavailable"), "invalid"])(
		"keeps baseline CLI capabilities separate from the server when probing returns %s",
		async (cli) => {
			useEditor("cursor");
			const { sessionApp, serverFeatures, cliAuth } = await checkCompatibility(
				cli,
				"2.38.0",
			);
			expect(sessionApp).toBe("vscode");
			expect(cliAuth.refuseRedirects).toBe(false);
			expect(serverFeatures.onSuccessBuild).toBe(true);
		},
	);

	async function writeConfig(
		sshConfigOptions?: Record<string, string>,
		{ connectionSetup } = createConnectionSetup(),
		configFile?: string,
	) {
		useEditor("cursor");
		vi.mocked(resolveSshProperties).mockRejectedValue(new Error("no ssh"));
		return connectionSetup.writeSshConfig({
			workspaceClient: mockClient(undefined, sshConfigOptions),
			parts: parseRemoteAuthority(REMOTE_AUTHORITY)!,
			binaryPath: "/mock/coder",
			logDir: "/mock/log",
			cliAuth: CLI_AUTH,
			sessionApp: "future-editor-next",
			configFile,
			sshPath: undefined,
		});
	}

	it("writes the app name and forwards the session type", async () => {
		const config = await writeConfig();
		expect(config.proxycommand).toContain("--usage-app=future-editor-next ");
		expect(config.sendenv).toBe("CODER_SSH_SESSION_TYPE");
		expect(config.permitlocalcommand).toBe("no");
	});

	it("ignores deployment SetEnv and SendEnv, warning until dismissed", async () => {
		const context = createConnectionSetup();
		context.userInteraction.setResponse(/^Ignored SSH/, "Don't Show Again");
		const config = await writeConfig(
			{ SetEnv: "CODER_SSH_SESSION_TYPE=spoofed", SendEnv: "SECRET" },
			context,
		);
		expect(config.setenv).toBeUndefined();
		expect(config.sendenv).toBe("CODER_SSH_SESSION_TYPE");
		await flush();

		// A dismissed subset stays hidden; a new option warns again.
		await writeConfig({ sendenv: "SECRET" }, context);
		await writeConfig({ SendEnv: "SECRET", User: "x" }, context);
		expect(
			context.userInteraction.getMessageCalls().map((call) => call.message),
		).toEqual([
			expect.stringContaining(": SetEnv, SendEnv."),
			expect.stringContaining(": SendEnv, User."),
		]);
	});

	describe("HOME ssh config on Windows", () => {
		const homeConfig = "/h/.ssh/config";

		/** Writes the config while Git for Windows ssh would read `homeConfig`. */
		async function writeWithHomeConfig(configFile?: string) {
			vi.mocked(getHomeSshConfigPath).mockReturnValue(homeConfig);
			const logger = createMockLogger();
			const context = createConnectionSetup(logger);
			await writeConfig(undefined, context, configFile);
			return logger;
		}

		interface HomeConfigCase {
			configFile?: string;
			included: boolean;
		}
		it.each<HomeConfigCase>([
			{ included: true },
			{ configFile: "/mock/ssh/config", included: false },
		])(
			"includes the Coder config: $included with -F $configFile",
			async ({ configFile, included }) => {
				await writeWithHomeConfig(configFile);
				expect(vol.existsSync(homeConfig)).toBe(included);
			},
		);

		it("warns and still connects when it cannot be written", async () => {
			vol.fromJSON({ "/h": "not a directory" });
			const logger = await writeWithHomeConfig();
			expect(logger.warn).toHaveBeenCalledWith(
				"Failed to include the Coder SSH config in",
				homeConfig,
				expect.any(Error),
			);
		});
	});
});

describe("ProxyCommand", () => {
	it.each<SshFlagsCase>([
		{
			name: "disables autostart by default",
			expected:
				"ssh --disable-autostart --stdio --usage-app=vscode --network-info-dir <dir> --ssh-host-prefix coder-vscode.coder.example.com-- %h",
		},
		{
			name: "passes the user's flags ahead of the managed ones",
			flags: ["--wait=yes"],
			expected:
				"ssh --wait=yes --stdio --usage-app=vscode --network-info-dir <dir> --ssh-host-prefix coder-vscode.coder.example.com-- %h",
		},
	])("$name", ({ flags, expected }) => {
		const config = new MockConfigurationProvider();
		if (flags) {
			config.set("coder.sshFlags", flags);
		}

		const proxyCommand = buildSshProxyCommand({
			pathResolver: new PathResolver("/mock/global", "/mock/log"),
			binaryPath: "/mock/coder",
			cliAuth: CLI_AUTH,
			logArgs: [],
			sessionApp: "vscode",
			hostPrefix: "coder-vscode.coder.example.com--",
		});

		expect(elideNetworkInfoDir(proxyCommand)).toBe(
			`/mock/coder "--token=" --global-config /mock/global --url https://coder.example.com --use-keyring=false ${expected}`,
		);
	});

	// OpenSSH runs the command with `sh -c` on Unix; Win32-OpenSSH passes it
	// to CreateProcessW, so the program's argv parser splits it.
	it("reaches the CLI unchanged through this platform's OpenSSH", () => {
		// A drive path on Windows reaches the CLI with `/`.
		const configDir = isWindows()
			? String.raw`C:\Users\John Doe\AppData\coder`
			: "/Users/me/Library/Application Support/coder";
		const headerCommand = 'echo "X: $TOKEN" "C:\\a b\\" `id`';
		const pathResolver = new PathResolver("/mock/global", "/mock/log");
		new MockConfigurationProvider().set("coder.headerCommand", headerCommand);
		const proxyCommand = buildSshProxyCommand({
			pathResolver,
			binaryPath: "coder",
			cliAuth: { ...CLI_AUTH, configDir },
			logArgs: [],
			sessionApp: "vscode",
			hostPrefix: "coder-vscode.coder.example.com--",
		});

		// Swap the CLI for Node printing the arguments it receives.
		const printArgv = proxyCommand.replace(
			/^coder /,
			`-p "JSON.stringify(process.argv.slice(1))" -- `,
		);
		const result = isWindows()
			? spawnSync(process.execPath, [printArgv], {
					argv0: "node",
					encoding: "utf8",
					windowsVerbatimArguments: true,
				})
			: spawnSync("sh", ["-c", `"$NODE" ${printArgv}`], {
					encoding: "utf8",
					env: { ...process.env, NODE: process.execPath },
				});

		expect(JSON.parse(result.stdout)).toStrictEqual([
			"--token=",
			"--global-config",
			configDir.replaceAll("\\", "/"),
			"--url",
			CLI_AUTH.url,
			"--use-keyring=false",
			"--header-command",
			headerCommand,
			"ssh",
			"--disable-autostart",
			"--stdio",
			"--usage-app=vscode",
			"--network-info-dir",
			pathResolver.getNetworkInfoPath(),
			"--ssh-host-prefix",
			"coder-vscode.coder.example.com--",
			"%h",
		]);
	});
});
