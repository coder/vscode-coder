import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	mergeSshConfigValues,
	parseCoderSshOptions,
	parseSshConfig,
	SshConfig,
	type SshInclude,
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

const deploymentBlock = `# --- START CODER dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER dev.coder.com ---`;
const staleDeploymentBlock = `# --- START CODER dev.coder.com ---
Host stale
# --- END CODER dev.coder.com ---`;
const otherDeploymentBlock = `# --- START CODER other.coder.com ---
Host coder-vscode.other.coder.com--*
# --- END CODER other.coder.com ---`;
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

const include = {
	id: "vscode",
	includePath: "~/.ssh/coder/config",
} satisfies SshInclude;

function renderIncludeBlock(value: SshInclude): string {
	return `# --- START CODER ${value.id} ---
# Moves back to the top on connect; override options via coder.sshConfig.
Include "${value.includePath}"
# --- END CODER ${value.id} ---`;
}

const includeBlock = renderIncludeBlock(include);
const otherIncludeBlock = renderIncludeBlock({
	id: "windsurf",
	includePath: "~/.ssh/windsurf/config",
});

const mockLogger = createMockLogger();
// Captured before any spy so injected implementations can delegate to memfs.
const realReadFile = fsPromises.readFile;
const realRename = fsPromises.rename;

const readConfig = () => realReadFile(sshFilePath, "utf-8");

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
	await sshConfig.update(hostname, values, overrides);
}

async function updateInclude(
	contents: string,
	value: SshInclude = include,
): Promise<void> {
	const sshConfig = await loadSshConfig(contents);
	await sshConfig.updateInclude(value, hostname);
}

function injectConcurrentChangeBeforeRename(contents: string): void {
	vi.spyOn(fsPromises, "readFile").mockImplementationOnce(
		(filePath, options) => {
			vol.writeFileSync(sshFilePath, contents);
			return realReadFile(filePath, options);
		},
	);
}

function injectConcurrentChangeAfterRename(contents: string): void {
	vi.spyOn(fsPromises, "rename").mockImplementationOnce(
		async (source, destination) => {
			await realRename(source, destination);
			vol.writeFileSync(sshFilePath, contents);
		},
	);
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

	interface DeploymentMergeCase {
		name: string;
		existing: string;
		expected: string;
	}
	it.each<DeploymentMergeCase>([
		{
			name: "appends after user config",
			existing: "Host personal\n  HostName example.com\n\n",
			expected: `${fileHeader}\n\nHost personal\n  HostName example.com\n\n${deploymentBlock}`,
		},
		{
			name: "replaces only the current deployment",
			existing: `Host before\n\n${staleDeploymentBlock}\n\nHost after`,
			expected: `${fileHeader}\n\nHost before\n\n${deploymentBlock}\n\nHost after`,
		},
		{
			name: "does not duplicate the header",
			existing: `${fileHeader}\n\n${staleDeploymentBlock}`,
			expected: `${fileHeader}\n\n${deploymentBlock}`,
		},
		{
			name: "moves the header back to the top",
			existing: `Host personal\n\n${fileHeader}\n\n${staleDeploymentBlock}`,
			expected: `${fileHeader}\n\nHost personal\n\n${deploymentBlock}`,
		},
		{
			name: "preserves another deployment",
			existing: otherDeploymentBlock,
			expected: `${fileHeader}\n\n${otherDeploymentBlock}\n\n${deploymentBlock}`,
		},
		{
			name: "preserves deployment-unaware config",
			existing: deploymentUnawareBlock,
			expected: `${fileHeader}\n\n${deploymentUnawareBlock}\n\n${deploymentBlock}`,
		},
	])("$name", async ({ existing, expected }) => {
		await updateDeployment(existing);
		expect(await readConfig()).toBe(expected);
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

# --- START CODER dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 500
  ExtraKey ExtraValue
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  UserKnownHostsFile /dev/null
  loglevel DEBUG
# --- END CODER dev.coder.com ---`);
	});

	interface MalformedDeploymentCase {
		name: string;
		existing: string;
		error: string;
	}
	it.each<MalformedDeploymentCase>([
		{
			name: "missing end marker",
			existing: "# --- START CODER dev.coder.com ---",
			error:
				'has 1 "# --- START CODER dev.coder.com ---" and 0 "# --- END CODER dev.coder.com ---" markers',
		},
		{
			name: "extra start marker",
			existing: `${staleDeploymentBlock}\n# --- START CODER dev.coder.com ---`,
			error:
				'has 2 "# --- START CODER dev.coder.com ---" and 1 "# --- END CODER dev.coder.com ---" markers',
		},
		{
			name: "extra end marker",
			existing: `${staleDeploymentBlock}\n# --- END CODER dev.coder.com ---`,
			error:
				'has 1 "# --- START CODER dev.coder.com ---" and 2 "# --- END CODER dev.coder.com ---" markers',
		},
		{
			name: "duplicate blocks",
			existing: `${staleDeploymentBlock}\n${staleDeploymentBlock}`,
			error: 'has 2 "# --- START CODER dev.coder.com ---" blocks',
		},
		{
			name: "end before start",
			existing:
				"# --- END CODER dev.coder.com ---\n# --- START CODER dev.coder.com ---",
			error:
				'"# --- END CODER dev.coder.com ---" marker before its "# --- START CODER dev.coder.com ---" marker',
		},
	])("rejects $name", async ({ existing, error }) => {
		const sshConfig = await loadSshConfig(existing);
		await expect(sshConfig.update(hostname, BASE_SSH_VALUES)).rejects.toThrow(
			error,
		);
		expect(await readConfig()).toBe(existing);
	});

	/**
	 * One case per input surface; the full character matrix is covered by the
	 * validateDeploymentSshOptions tests below.
	 */
	interface RejectCase {
		name: string;
		safeHostname?: string;
		values?: SshValues;
		overrides?: Record<string, string>;
	}

	it.each<RejectCase>([
		{
			name: "deployment hostname newline",
			safeHostname: "dev.coder.com\nHost *",
		},
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
		async ({
			safeHostname = hostname,
			values = BASE_SSH_VALUES,
			overrides,
		}) => {
			const sshConfig = await loadSshConfig();

			await expect(
				sshConfig.update(safeHostname, values, overrides),
			).rejects.toThrow();
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
			name: "moves to first",
			existing: `Host *\n\n${includeBlock}`,
			expected: `${includeBlock}\n\nHost *`,
		},
	])("handles $name", async ({ existing, expected }) => {
		await updateInclude(existing);
		expect(await readConfig()).toBe(expected);
	});

	it("replaces the current editor block and preserves another editor", async () => {
		const stale = includeBlock.replace("coder/config", "old/config");
		await updateInclude(`Host *\n\n${stale}\n\n${otherIncludeBlock}`);
		expect(await readConfig()).toBe(
			`${includeBlock}\n\nHost *\n\n${otherIncludeBlock}`,
		);
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
			name: "missing end marker",
			existing: includeBlock.replace("# --- END CODER vscode ---", ""),
			error:
				'has 1 "# --- START CODER vscode ---" and 0 "# --- END CODER vscode ---" markers',
		},
		{
			name: "mismatched end marker",
			existing: includeBlock.replace(
				"# --- END CODER vscode ---",
				"# --- END CODER windsurf ---",
			),
			error:
				'has 1 "# --- START CODER vscode ---" and 0 "# --- END CODER vscode ---" markers',
		},
		{
			name: "duplicate blocks",
			existing: `${includeBlock}\n${includeBlock}`,
			error: 'has 2 "# --- START CODER vscode ---" blocks',
		},
		{
			name: "end before start",
			existing: "# --- END CODER vscode ---\n# --- START CODER vscode ---",
			error:
				'"# --- END CODER vscode ---" marker before its "# --- START CODER vscode ---" marker',
		},
	])("rejects $name", async ({ existing, error }) => {
		await expect(updateInclude(existing)).rejects.toThrow(error);
		expect(await readConfig()).toBe(existing);
	});

	it("supports dashed editor IDs", async () => {
		const dashed = { ...include, id: "vscode-insiders" };
		await updateInclude("", dashed);
		expect(await readConfig()).toBe(renderIncludeBlock(dashed));
	});

	it("rejects an empty editor ID", async () => {
		await expect(updateInclude("", { ...include, id: "" })).rejects.toThrow(
			"Editor ID must not be empty",
		);
	});

	interface IncludePathEscapeCase {
		includePath: string;
		escaped: string;
	}
	it.each<IncludePathEscapeCase>([
		{
			includePath: "~/.ssh/we[i]rd/*?[config]",
			escaped: "~/.ssh/we\\[i\\]rd/\\*\\?\\[config\\]",
		},
		{
			includePath: "C:\\Users\\Jane Doe\\config",
			escaped: "C:/Users/Jane Doe/config",
		},
	])("escapes $includePath", async ({ includePath, escaped }) => {
		await updateInclude("", { ...include, includePath });
		expect(await readConfig()).toContain(`Include "${escaped}"`);
	});

	// A tilde swallows home-path quirks that ssh could not read back otherwise.
	it.each([
		{ label: "plain", home: homeDir },
		{ label: "weird", home: "/home/we[i]rd %user" },
	])(
		"writes a $label home-relative include path with a tilde",
		async ({ home }) => {
			vi.mocked(os.homedir).mockReturnValue(home);
			await updateInclude("", {
				...include,
				includePath: `${home}/.config/Code/ssh-config`,
			});
			expect(await readConfig()).toContain(
				'Include "~/.config/Code/ssh-config"',
			);
		},
	);

	type InvalidIncludePath = string;
	it.each<InvalidIncludePath>([
		"path\rname",
		"path\nname",
		"path\0name",
		'path"name',
		"path%name",
	])("rejects unrepresentable include paths", async (includePath) => {
		await expect(
			updateInclude("", { ...include, includePath }),
		).rejects.toThrow("must not contain CR, LF, NUL");
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
		await sshConfig.update(hostname, BASE_SSH_VALUES);
		expect(vol.statSync(sshFilePath).mode & 0o777).toBe(mode);
	});

	type FileSystemErrorStage = "load" | "conflict read" | "stat";
	it.each<FileSystemErrorStage>(["load", "conflict read", "stat"])(
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
			if (stage === "conflict read") {
				vi.spyOn(fsPromises, "readFile").mockRejectedValueOnce(denied);
			} else {
				vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(denied);
			}
			await expect(sshConfig.update(hostname, BASE_SSH_VALUES)).rejects.toThrow(
				"denied",
			);
		},
	);

	it("wraps write failures", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		vi.spyOn(fsPromises, "writeFile").mockRejectedValueOnce(
			new Error("EACCES"),
		);
		await expect(sshConfig.update(hostname, BASE_SSH_VALUES)).rejects.toThrow(
			/Failed to write temporary SSH config file.*EACCES/,
		);
	});

	it("wraps rename failures and removes the temporary file", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		const error = Object.assign(new Error("EXDEV"), { code: "EXDEV" });
		vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(error);
		await expect(sshConfig.update(hostname, BASE_SSH_VALUES)).rejects.toThrow(
			"Failed to rename temporary SSH config file",
		);
		const leftoverTempFiles = Object.keys(vol.toJSON()).filter((filePath) =>
			filePath.includes("vscode-coder-tmp"),
		);
		expect(leftoverTempFiles).toEqual([]);
	});

	it("retries a transient Windows rename failure", async () => {
		const realPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		vi.useFakeTimers();
		try {
			const sshConfig = await loadSshConfig("Host initial");
			const error = Object.assign(new Error("EPERM"), { code: "EPERM" });
			const renameSpy = vi
				.spyOn(fsPromises, "rename")
				.mockRejectedValueOnce(error);
			const update = sshConfig.update(hostname, BASE_SSH_VALUES);
			await vi.advanceTimersByTimeAsync(100);
			await update;
			expect(renameSpy).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
			Object.defineProperty(process, "platform", { value: realPlatform });
		}
	});

	it("retries an update conflict detected before rename", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		const writeFileSpy = vi.spyOn(fsPromises, "writeFile");
		const renameSpy = vi.spyOn(fsPromises, "rename");
		injectConcurrentChangeBeforeRename(otherDeploymentBlock);
		await sshConfig.update(hostname, BASE_SSH_VALUES);
		expect(await readConfig()).toBe(
			`${fileHeader}\n\n${otherDeploymentBlock}\n\n${deploymentBlock}`,
		);
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
		expect(renameSpy).toHaveBeenCalledTimes(1);
	});

	it("retries an include conflict detected after rename", async () => {
		const sshConfig = await loadSshConfig("Host initial");
		const renameSpy = vi.spyOn(fsPromises, "rename");
		injectConcurrentChangeAfterRename(
			`${otherIncludeBlock}\n\nHost concurrent\n\n${includeBlock}\n\n${legacyDeploymentBlock}`,
		);
		await sshConfig.updateInclude(include, hostname);
		expect(await readConfig()).toBe(
			`${includeBlock}\n\n${otherIncludeBlock}\n\nHost concurrent`,
		);
		expect(renameSpy).toHaveBeenCalledTimes(2);
	});

	it("fails after bounded optimistic retries", async () => {
		vol.fromJSON({ [sshFilePath]: "Host initial" });
		const writeFileSpy = vi.spyOn(fsPromises, "writeFile");
		const renameSpy = vi.spyOn(fsPromises, "rename");
		let destinationReads = 0;
		vi.spyOn(fsPromises, "readFile").mockImplementation((filePath, options) => {
			if (filePath === sshFilePath && ++destinationReads > 1) {
				vol.writeFileSync(sshFilePath, `Host revision-${destinationReads}`);
			}
			return realReadFile(filePath, options);
		});
		const sshConfig = new SshConfig(sshFilePath, mockLogger, fsPromises);
		await sshConfig.load();
		await expect(sshConfig.updateInclude(include, hostname)).rejects.toThrow(
			"because it kept changing",
		);
		expect(writeFileSpy).toHaveBeenCalledTimes(3);
		expect(renameSpy).not.toHaveBeenCalled();
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
