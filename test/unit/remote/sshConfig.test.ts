import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	cleanupStaleSshConfigs,
	mergeSshConfigValues,
	parseCoderSshOptions,
	parseSshConfig,
	SshConfig,
	type SshValues,
	validateDeploymentSshOptions,
} from "@/remote/sshConfig";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: vi.fn(() => "/Path/To/UserHomeDir") };
});

const homeDir = "/Path/To/UserHomeDir";
const sshFilePath = "/Path/To/UserHomeDir/.sshConfigDir/sshConfigFile";
const hostname = "dev.coder.com";
const fileHeader = `# Coder workspace hosts. Do not edit; the Coder extension rewrites this file
# on every connection. Override options with the "coder.sshConfig" setting.`;

const BASE_SSH_VALUES = {
	Host: "coder-vscode.dev.coder.com--*",
	ProxyCommand: "some-command-here",
	ConnectTimeout: "0",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "/dev/null",
	LogLevel: "ERROR",
	ServerAliveInterval: "10",
	ServerAliveCountMax: "3",
} as const satisfies SshValues;

const USER_OVERRIDES = {
	ForwardAgent: "yes",
	IdentityFile: "~/.ssh/coder identity",
} as const;

const BENIGN_DEPLOYMENT_OPTIONS = {
	ConnectTimeout: "30",
	IdentityFile: "~/.ssh/coder identity",
	SetEnv: "CODER_SSH_SESSION_TYPE=vscode",
	serveraliveinterval: "5",
} as const;

const deploymentBlock = `Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null`;
// Released versions wrote deployment blocks with the VSCODE label.
const legacyDeploymentBlock = `# --- START CODER VSCODE dev.coder.com ---
Host stale
# --- END CODER VSCODE dev.coder.com ---`;
const legacyOtherDeploymentBlock = `# --- START CODER VSCODE other.coder.com ---
Host coder-vscode.other.coder.com--*
# --- END CODER VSCODE other.coder.com ---`;
const deploymentUnawareBlock = `# --- START CODER VSCODE ---
Host coder-vscode--*
# --- END CODER VSCODE ---`;

const includeDir = "~/.ssh/coder";

function renderIncludeBlock(dir: string): string {
	return `# --- START CODER ---
# Moves back to the top on connect; override options via coder.sshConfig.
Include "${dir}/*.conf"
# --- END CODER ---`;
}

const includeBlock = renderIncludeBlock(includeDir);

const mockLogger = createMockLogger();

const readConfig = () => fsPromises.readFile(sshFilePath, "utf-8");

async function loadSshConfig(
	contents?: string,
	mode = 0o644,
): Promise<SshConfig> {
	if (contents !== undefined) {
		vol.fromJSON({ [sshFilePath]: contents });
		vol.chmodSync(sshFilePath, mode);
	}
	const sshConfig = new SshConfig(sshFilePath, mockLogger, fsPromises);
	await sshConfig.load();
	return sshConfig;
}

async function updateDeployment(
	contents?: string,
	values: SshValues = BASE_SSH_VALUES,
	overrides?: Record<string, string>,
): Promise<void> {
	const sshConfig = await loadSshConfig(contents);
	await sshConfig.update(values, overrides);
}

async function updateInclude(
	contents: string,
	dir: string = includeDir,
): Promise<void> {
	const sshConfig = await loadSshConfig(contents);
	await sshConfig.updateInclude(dir, hostname);
}

beforeEach(() => {
	vol.reset();
	vi.mocked(os.homedir).mockReturnValue(homeDir);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SshConfig.getRaw", () => {
	it("throws before load", () => {
		const sshConfig = new SshConfig(sshFilePath, mockLogger, fsPromises);
		expect(() => sshConfig.getRaw()).toThrow("SshConfig is not loaded");
	});
});

describe("SshConfig.update", () => {
	it("renders the exact header and deployment config", async () => {
		await updateDeployment();

		expect(await readConfig()).toBe(`${fileHeader}\n\n${deploymentBlock}`);
		const configDir = vol.statSync("/Path/To/UserHomeDir/.sshConfigDir");
		expect(configDir.mode & 0o777).toBe(0o700);
	});

	it("regenerates the whole file over existing content", async () => {
		await updateDeployment("Host personal\n  HostName example.com\n\n");
		expect(await readConfig()).toBe(`${fileHeader}\n\n${deploymentBlock}`);
	});

	it("rewrites an unchanged file so its mtime marks the last connect", async () => {
		const renameSpy = vi.spyOn(fsPromises, "rename");
		await updateDeployment(`${fileHeader}\n\n${deploymentBlock}`);
		expect(renameSpy).toHaveBeenCalledTimes(1);
	});

	it("applies sorted case-insensitive overrides, additions, and removals", async () => {
		await updateDeployment(undefined, BASE_SSH_VALUES, {
			loglevel: "DEBUG",
			ConnectTimeout: "500",
			ExtraKey: "ExtraValue",
			StrictHostKeyChecking: "",
			ExtraRemove: "",
		});

		expect(await readConfig()).toBe(`${fileHeader}

Host coder-vscode.dev.coder.com--*
  ConnectTimeout 500
  ExtraKey ExtraValue
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  UserKnownHostsFile /dev/null
  loglevel DEBUG`);
	});

	/**
	 * One case per input surface; the full character matrix is covered by the
	 * validateDeploymentSshOptions tests below.
	 */
	interface RejectCase {
		name: string;
		values?: SshValues;
		overrides?: Record<string, string>;
	}

	it.each<RejectCase>([
		{
			name: "Host value carriage return",
			values: { ...BASE_SSH_VALUES, Host: "coder-vscode--*\rMatch all" },
		},
		{
			name: "managed value newline",
			values: {
				...BASE_SSH_VALUES,
				ProxyCommand: "some-command-here\nRemoteCommand calc",
			},
		},
		{
			name: "override key whitespace",
			overrides: { "ForwardAgent RemoteCommand": "yes" },
		},
		{
			name: "override value newline",
			overrides: { ForwardAgent: "yes\nRemoteCommand calc" },
		},
	])(
		"rejects unsafe serialization: $name",
		async ({ values = BASE_SSH_VALUES, overrides }) => {
			const sshConfig = await loadSshConfig();

			await expect(sshConfig.update(values, overrides)).rejects.toThrow();
			expect(vol.existsSync(sshFilePath)).toBe(false);
		},
	);

	it("accepts benign override options", async () => {
		await updateDeployment(undefined, BASE_SSH_VALUES, USER_OVERRIDES);

		const writtenConfig = await readConfig();
		expect(writtenConfig).toContain("  ForwardAgent yes");
		expect(writtenConfig).toContain("  IdentityFile ~/.ssh/coder identity");
	});
});

describe("SshConfig.updateInclude", () => {
	interface IncludePositionCase {
		name: string;
		existing: string;
		expected: string;
	}
	it.each<IncludePositionCase>([
		{ name: "empty config", existing: "", expected: includeBlock },
		{
			name: "prepends to user config",
			existing: "Host *\n  ConnectTimeout 5",
			expected: `${includeBlock}\n\nHost *\n  ConnectTimeout 5`,
		},
		{
			name: "already first",
			existing: `${includeBlock}\n\nHost *`,
			expected: `${includeBlock}\n\nHost *`,
		},
		{
			name: "moves a stale block to first",
			existing: `Host *\n\n${includeBlock.replace("coder/*.conf", "old/*.conf")}`,
			expected: `${includeBlock}\n\nHost *`,
		},
	])("handles $name", async ({ existing, expected }) => {
		await updateInclude(existing);
		expect(await readConfig()).toBe(expected);
	});

	it("removes the current deployment and preserves other and deployment-unaware blocks", async () => {
		await updateInclude(
			`${legacyOtherDeploymentBlock}\n\n${legacyDeploymentBlock}\n\n${deploymentUnawareBlock}`,
		);
		expect(await readConfig()).toBe(
			`${includeBlock}\n\n${legacyOtherDeploymentBlock}\n\n${deploymentUnawareBlock}`,
		);
	});

	interface MalformedEditorCase {
		name: string;
		existing: string;
		error: string;
	}
	it.each<MalformedEditorCase>([
		{
			name: "extra end marker",
			existing: `${includeBlock}\n# --- END CODER ---`,
			error:
				'has 1 "# --- START CODER ---" and 2 "# --- END CODER ---" markers',
		},
		{
			name: "duplicate blocks",
			existing: `${includeBlock}\n${includeBlock}`,
			error: 'has 2 "# --- START CODER ---" blocks',
		},
		{
			name: "end before start",
			existing: "# --- END CODER ---\n# --- START CODER ---",
			error:
				'"# --- END CODER ---" marker before its "# --- START CODER ---" marker',
		},
	])("rejects $name", async ({ existing, error }) => {
		await expect(updateInclude(existing)).rejects.toThrow(error);
		expect(await readConfig()).toBe(existing);
	});

	interface IncludePathEscapeCase {
		dir: string;
		escaped: string;
	}
	it.each<IncludePathEscapeCase>([
		{
			dir: "~/.ssh/we[i]rd/*?[dir]",
			escaped: "~/.ssh/we\\[i\\]rd/\\*\\?\\[dir\\]",
		},
		{
			dir: "C:\\Users\\Jane Doe\\ssh",
			escaped: "C:/Users/Jane Doe/ssh",
		},
	])("escapes $dir", async ({ dir, escaped }) => {
		await updateInclude("", dir);
		expect(await readConfig()).toContain(`Include "${escaped}/*.conf"`);
	});

	// A tilde swallows home-path quirks that ssh could not read back otherwise.
	it("writes a home-relative include path with a tilde", async () => {
		const home = "/home/we[i]rd %user";
		vi.mocked(os.homedir).mockReturnValue(home);
		await updateInclude("", `${home}/.local/share/coder.coder-remote/ssh`);
		expect(await readConfig()).toContain(
			'Include "~/.local/share/coder.coder-remote/ssh/*.conf"',
		);
	});

	type InvalidIncludeDir = string;
	it.each<InvalidIncludeDir>([
		"path\rname",
		"path\nname",
		"path\0name",
		'path"name',
		"path%name",
	])("rejects unrepresentable include paths", async (dir) => {
		await expect(updateInclude("", dir)).rejects.toThrow(
			"must not contain CR, LF, NUL",
		);
	});
});

describe("persistence", () => {
	interface FileModeCase {
		name: string;
		existing: string | undefined;
		mode: number;
	}
	it.each<FileModeCase>([
		{ name: "new file", existing: undefined, mode: 0o600 },
		{ name: "existing file", existing: "Host *", mode: 0o640 },
	])("uses the correct mode for a $name", async ({ existing, mode }) => {
		const sshConfig = await loadSshConfig(existing, mode);
		await sshConfig.update(BASE_SSH_VALUES);
		expect(vol.statSync(sshFilePath).mode & 0o777).toBe(mode);
	});

	type FileSystemErrorStage = "load" | "include read" | "stat";
	it.each<FileSystemErrorStage>(["load", "include read", "stat"])(
		"propagates non-ENOENT %s errors",
		async (stage) => {
			const denied = Object.assign(new Error("denied"), { code: "EACCES" });
			if (stage === "load") {
				vol.fromJSON({ [sshFilePath]: "Host initial" });
				vi.spyOn(fsPromises, "readFile").mockRejectedValueOnce(denied);
				const sshConfig = new SshConfig(sshFilePath, mockLogger, fsPromises);
				await expect(sshConfig.load()).rejects.toBe(denied);
				return;
			}
			const sshConfig = await loadSshConfig("Host initial");
			if (stage === "include read") {
				vi.spyOn(fsPromises, "readFile").mockRejectedValueOnce(denied);
				await expect(
					sshConfig.updateInclude(includeDir, hostname),
				).rejects.toThrow("denied");
				return;
			}
			vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(denied);
			await expect(sshConfig.update(BASE_SSH_VALUES)).rejects.toThrow("denied");
		},
	);

	it("wraps write failures", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		vi.spyOn(fsPromises, "writeFile").mockRejectedValueOnce(
			new Error("EACCES"),
		);
		await expect(sshConfig.update(BASE_SSH_VALUES)).rejects.toThrow(
			/Failed to write temporary SSH config file.*EACCES/,
		);
	});

	it("wraps rename failures and removes the temporary file", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		const error = Object.assign(new Error("EXDEV"), { code: "EXDEV" });
		vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(error);
		await expect(sshConfig.update(BASE_SSH_VALUES)).rejects.toThrow(
			"Failed to rename temporary SSH config file",
		);
		const leftoverTempFiles = Object.keys(vol.toJSON()).filter((filePath) =>
			filePath.includes("vscode-coder-tmp"),
		);
		expect(leftoverTempFiles).toEqual([]);
	});

	it("writes over a concurrent change using the freshly read content", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		// The include update reads right before merging, so it picks up content
		// written after load().
		vol.writeFileSync(sshFilePath, "Host concurrent");
		await sshConfig.updateInclude(includeDir, hostname);
		expect(await readConfig()).toBe(`${includeBlock}\n\nHost concurrent`);
	});

	it("does not rewrite the file when the include is already in place", async () => {
		const sshConfig = await loadSshConfig(`${includeBlock}\n\nHost *`);
		const writeFileSpy = vi.spyOn(fsPromises, "writeFile");
		const renameSpy = vi.spyOn(fsPromises, "rename");
		await sshConfig.updateInclude(includeDir, hostname);
		expect(writeFileSpy).not.toHaveBeenCalled();
		expect(renameSpy).not.toHaveBeenCalled();
	});
});

describe("cleanupStaleSshConfigs", () => {
	it("removes only generated configs not written for a week", async () => {
		const dir = "/Path/To/UserHomeDir/ssh";
		vol.fromJSON({
			[`${dir}/vscode--old.coder.com.conf`]: "stale",
			[`${dir}/cursor--fresh.coder.com.conf`]: "fresh",
			[`${dir}/unrelated.txt`]: "keep",
		});
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		vol.utimesSync(
			`${dir}/vscode--old.coder.com.conf`,
			eightDaysAgo,
			eightDaysAgo,
		);

		await cleanupStaleSshConfigs(dir, mockLogger);

		expect(Object.keys(vol.toJSON()).sort()).toEqual([
			`${dir}/cursor--fresh.coder.com.conf`,
			`${dir}/unrelated.txt`,
		]);
	});
});

describe("parseSshConfig", () => {
	interface ParseSshConfigCase {
		name: string;
		input: string[];
		expected: Record<string, string>;
	}
	it.each<ParseSshConfigCase>([
		{
			name: "parses space and equals separators",
			input: ["ConnectTimeout 10", "LogLevel=DEBUG"],
			expected: { ConnectTimeout: "10", LogLevel: "DEBUG" },
		},
		{
			name: "accumulates non-empty SetEnv values",
			input: ["SetEnv A=1", "setenv=B=2 C=3", "SetEnv="],
			expected: { SetEnv: "A=1 B=2 C=3" },
		},
		{
			name: "skips malformed lines",
			input: ["malformed", "Key:value", "# comment", "key=value"],
			expected: { key: "value" },
		},
	])("$name", ({ input, expected }) => {
		expect(parseSshConfig(input)).toEqual(expected);
	});
});

describe("mergeSshConfigValues", () => {
	interface MergeSshConfigCase {
		name: string;
		config: Record<string, string>;
		overrides: Record<string, string>;
		expected: Record<string, string>;
	}
	it.each<MergeSshConfigCase>([
		{
			name: "overrides case-insensitively and preserves other values",
			config: { LogLevel: "ERROR", Keep: "yes" },
			overrides: { loglevel: "DEBUG" },
			expected: { loglevel: "DEBUG", Keep: "yes" },
		},
		{
			name: "adds and removes keys",
			config: { Remove: "value" },
			overrides: { Remove: "", Add: "value" },
			expected: { Add: "value" },
		},
		{
			name: "combines SetEnv and ignores an empty override",
			config: { SetEnv: "A=1" },
			overrides: { setenv: "B=2" },
			expected: { SetEnv: "A=1 B=2" },
		},
		{
			name: "keeps SetEnv for an empty override",
			config: { SetEnv: "A=1" },
			overrides: { SetEnv: "" },
			expected: { SetEnv: "A=1" },
		},
		{
			name: "adds SetEnv from overrides",
			config: {},
			overrides: { SetEnv: "A=1" },
			expected: { SetEnv: "A=1" },
		},
	])("$name", ({ config, overrides, expected }) => {
		expect(mergeSshConfigValues(config, overrides)).toEqual(expected);
	});
});

describe("parseCoderSshOptions", () => {
	const coderBlock = (...lines: string[]) =>
		`# ------------START-CODER-----------\n${lines.join("\n")}\n# ------------END-CODER------------`;

	interface ParseCoderOptionsCase {
		name: string;
		raw: string;
		expected: Record<string, string>;
	}
	it.each<ParseCoderOptionsCase>([
		{ name: "no block", raw: "Host personal", expected: {} },
		{
			name: "options only",
			raw: coderBlock(
				"# :wait=yes",
				"# :ssh-option=ForwardX11=yes",
				"# :ssh-option=SetEnv=FOO=1",
				"# :ssh-option=SetEnv=BAR=2",
			),
			expected: { ForwardX11: "yes", SetEnv: "FOO=1 BAR=2" },
		},
		{
			name: "flexible marker dashes",
			raw: "# ---START-CODER---\n# :ssh-option=ForwardX11=yes\n# ---END-CODER---",
			expected: { ForwardX11: "yes" },
		},
	])("$name", ({ raw, expected }) => {
		expect(parseCoderSshOptions(raw)).toEqual(expected);
	});
});

describe("validateDeploymentSshOptions", () => {
	it.each([
		// Restructure the config.
		"Host",
		"Match",
		"Include",
		"ProxyJump",
		// Run code.
		"ProxyCommand",
		"LocalCommand",
		"PermitLocalCommand",
		"RemoteCommand",
		"KnownHostsCommand",
		// Load shared libraries.
		"PKCS11Provider",
		"SecurityKeyProvider",
		"SmartcardDevice",
		// Execute a command for X11 authentication.
		"XAuthLocation",
	])("rejects %s case-insensitively", (key) => {
		expect(() =>
			validateDeploymentSshOptions({ [key.toLowerCase()]: "value" }, {}),
		).toThrow(
			`The Coder deployment tried to set SSH options that could run code or change how Coder connects: ${JSON.stringify(key.toLowerCase())}.`,
		);
		expect(() =>
			validateDeploymentSshOptions({ [key.toUpperCase()]: "value" }, {}),
		).toThrow();
	});

	interface MalformedCase {
		name: string;
		key: string;
		value: unknown;
	}

	it.each<MalformedCase>([
		{ name: "empty key", key: "", value: "value" },
		{ name: "key whitespace", key: "Forward Agent", value: "yes" },
		{ name: "key equals", key: "ForwardAgent=", value: "yes" },
		{ name: "key punctuation", key: "ForwardAgent#", value: "yes" },
		{ name: "key carriage return", key: "ForwardAgent\r", value: "yes" },
		{ name: "key newline", key: "ForwardAgent\n", value: "yes" },
		{ name: "key NUL", key: "ForwardAgent\0", value: "yes" },
		{ name: "value carriage return", key: "ForwardAgent", value: "yes\rno" },
		{ name: "value newline", key: "ForwardAgent", value: "yes\nno" },
		{ name: "value NUL", key: "ForwardAgent", value: "yes\0no" },
		{ name: "non-string value", key: "ForwardAgent", value: 42 },
	])("rejects $name", ({ key, value }) => {
		expect(() => validateDeploymentSshOptions({ [key]: value }, {})).toThrow();
	});

	it("accepts options outside the deny list in any case", () => {
		expect(() =>
			validateDeploymentSshOptions(BENIGN_DEPLOYMENT_OPTIONS, {}),
		).not.toThrow();
		expect(() =>
			validateDeploymentSshOptions(
				{
					CONNECTTIMEOUT: "30",
					ForwardAgent: "yes",
					StrictHostKeyChecking: "no",
					SomeFutureDirective: "value",
				},
				{},
			),
		).not.toThrow();
	});

	it("collects every denied option into one error", () => {
		expect(() =>
			validateDeploymentSshOptions(
				{
					ProxyCommand: "evil",
					LocalCommand: "evil",
					ConnectTimeout: "30",
				},
				{},
			),
		).toThrow('change how Coder connects: "ProxyCommand", "LocalCommand".');
	});

	it("offers the coder.sshConfig escape hatch only for options Coder does not manage", () => {
		expect(() =>
			validateDeploymentSshOptions({ LocalCommand: "evil" }, {}),
		).toThrow(
			'To allow "LocalCommand", set the option yourself in the "coder.sshConfig" setting',
		);
		// Coder always writes the pinned options itself.
		expect(() =>
			validateDeploymentSshOptions({ ProxyCommand: "evil" }, {}),
		).toThrow('Coder manages "ProxyCommand", which cannot be overridden.');
		expect(() =>
			validateDeploymentSshOptions({ ProxyCommand: "evil" }, {}),
		).not.toThrow(/coder\.sshConfig/);
		// Mixed: each option gets the advice that applies to it.
		expect(() =>
			validateDeploymentSshOptions(
				{ ProxyCommand: "evil", LocalCommand: "evil" },
				{},
			),
		).toThrow(/To allow "LocalCommand".*Coder manages "ProxyCommand"/s);
	});

	it("skips denied options the user overrides in coder.sshConfig", () => {
		// Case-insensitive: the user's value wins the merge, so the
		// deployment's value is never written.
		expect(() =>
			validateDeploymentSshOptions(
				{ ProxyCommand: "deployment value" },
				{ proxycommand: "user value" },
			),
		).not.toThrow();
		// Only the overridden key is exempt.
		expect(() =>
			validateDeploymentSshOptions(
				{ ProxyCommand: "deployment value", LocalCommand: "evil" },
				{ ProxyCommand: "user value" },
			),
		).toThrow('"LocalCommand"');
	});
});
