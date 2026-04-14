import { it, afterEach, vi, expect, describe, beforeEach } from "vitest";

import {
	SshConfig,
	parseCoderSshOptions,
	parseSshConfig,
	mergeSshConfigValues,
	type SshValues,
} from "@/remote/sshConfig";

import { createMockLogger } from "../../mocks/testHelpers";

// This is not the usual path to ~/.ssh/config, but
// setting it to a different path makes it easier to test
// and makes mistakes abundantly clear.
const sshFilePath = "/Path/To/UserHomeDir/.sshConfigDir/sshConfigFile";
const sshTempFilePrefix =
	"/Path/To/UserHomeDir/.sshConfigDir/.sshConfigFile.vscode-coder-tmp-";
const managedHeader = `# This section is managed by the Coder VS Code extension.
# Changes will be overwritten on the next workspace connection.`;

const mockFileSystem = {
	mkdir: vi.fn(),
	readFile: vi.fn(),
	rename: vi.fn(),
	stat: vi.fn(),
	unlink: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn(),
};

const mockLogger = createMockLogger();

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

afterEach(() => {
	vi.clearAllMocks();
});

it("creates a new file and adds config with empty label", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("", { ...BASE_SSH_VALUES, Host: "coder-vscode--*" });

	const expectedOutput = `# --- START CODER VSCODE ---
${managedHeader}
Host coder-vscode--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---`;

	expect(mockFileSystem.readFile).toHaveBeenCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("creates a new file and adds the config", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES);

	const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.readFile).toHaveBeenCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("adds a new coder config in an existent SSH configuration", async () => {
	const existentSSHConfig = `Host coder.something
  ConnectTimeout=0
  LogLevel ERROR
  HostName coder.something
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null`;
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES);

	const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("updates an existent coder config", async () => {
	const keepSSHConfig = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command

# --- START CODER VSCODE dev2.coder.com ---
Host coder-vscode.dev2.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev2.coder.com ---`;

	const existentSSHConfig = `${keepSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host *
  SetEnv TEST=1`;
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		...BASE_SSH_VALUES,
		Host: "coder-vscode.dev-updated.coder.com--*",
		ProxyCommand: "some-updated-command-here",
		ConnectTimeout: "1",
		StrictHostKeyChecking: "yes",
	});

	const expectedOutput = `${keepSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev-updated.coder.com--*
  ConnectTimeout 1
  LogLevel ERROR
  ProxyCommand some-updated-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking yes
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host *
  SetEnv TEST=1`;

	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("does not remove deployment-unaware SSH config and adds the new one", async () => {
	// Before the plugin supported multiple deployments, it would only write and
	// overwrite this one block.  We need to leave it alone so existing
	// connections keep working.  Only replace blocks specific to the deployment
	// that we are targeting.  Going forward, all new connections will use the new
	// deployment-specific block.
	const existentSSHConfig = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ConnectTimeout=0
  HostName coder.something
  LogLevel ERROR
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
# --- END CODER VSCODE ---`;
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES);

	const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("it does not remove a user-added block that only matches the host of an old coder SSH config", async () => {
	const existentSSHConfig = `Host coder-vscode--*
  ForwardAgent=yes`;
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES);

	const expectedOutput = `Host coder-vscode--*
  ForwardAgent=yes

# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("throws an error if there is a missing end block", async () => {
	// The below config is missing an end block.
	// This is a malformed config and should throw an error.
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null

Host afterconfig
  HostName after.config.tld
  User after`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", BASE_SSH_VALUES),
	).rejects.toThrow(
		`Malformed config: ${sshFilePath} has an unterminated START CODER VSCODE dev.coder.com block. Each START block must have an END block.`,
	);
});

it("throws an error if there is a mismatched start and end block count", async () => {
	// The below config contains two start blocks and one end block.
	// This is a malformed config and should throw an error.
	// Previously were were simply taking the first occurrences of the start and
	// end blocks, which would potentially lead to loss of any content between the
	// missing end block and the next start block.
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# missing END CODER VSCODE dev.coder.com ---

Host donotdelete
  HostName dont.delete.me
  User please

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host afterconfig
  HostName after.config.tld
  User after`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", BASE_SSH_VALUES),
	).rejects.toThrow(
		`Malformed config: ${sshFilePath} has an unterminated START CODER VSCODE dev.coder.com block. Each START block must have an END block.`,
	);
});

it("throws an error if there is a mismatched start and end block count (without label)", async () => {
	// As above, but without a label.
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# missing END CODER VSCODE ---

Host donotdelete
  HostName dont.delete.me
  User please

# --- START CODER VSCODE ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---

Host afterconfig
  HostName after.config.tld
  User after`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(sshConfig.update("", BASE_SSH_VALUES)).rejects.toThrow(
		`Malformed config: ${sshFilePath} has an unterminated START CODER VSCODE block. Each START block must have an END block.`,
	);
});

it("throws an error if there are more than one sections with the same label", async () => {
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host donotdelete
  HostName dont.delete.me
  User please

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host afterconfig
  HostName after.config.tld
  User after`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", BASE_SSH_VALUES),
	).rejects.toThrow(
		`Malformed config: ${sshFilePath} has 2 START CODER VSCODE dev.coder.com sections. Please remove all but one.`,
	);
});

it("correctly handles interspersed blocks with and without label", async () => {
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---

Host donotdelete
  HostName dont.delete.me
  User please

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host afterconfig
  HostName after.config.tld
  User after`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });
	await sshConfig.load();

	const expectedOutput = `Host beforeconfig
  HostName before.config.tld
  User before

# --- START CODER VSCODE ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---

Host donotdelete
  HostName dont.delete.me
  User please

# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host afterconfig
  HostName after.config.tld
  User after`;

	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES);

	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("override values", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", BASE_SSH_VALUES, {
		loglevel: "DEBUG", // This tests case insensitive
		ConnectTimeout: "500",
		ExtraKey: "ExtraValue",
		Foo: "bar",
		Buzz: "baz",
		// Remove this key
		StrictHostKeyChecking: "",
		ExtraRemove: "",
	});

	const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
${managedHeader}
Host coder-vscode.dev.coder.com--*
  Buzz baz
  ConnectTimeout 500
  ExtraKey ExtraValue
  Foo bar
  ProxyCommand some-command-here
  ServerAliveCountMax 3
  ServerAliveInterval 10
  UserKnownHostsFile /dev/null
  loglevel DEBUG
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.readFile).toHaveBeenCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
		sshFilePath,
	);
});

it("fails if we are unable to write the temporary file", async () => {
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before`;

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o600 });
	mockFileSystem.writeFile.mockRejectedValueOnce(new Error("EACCES"));

	await sshConfig.load();

	expect(mockFileSystem.readFile).toHaveBeenCalledWith(
		sshFilePath,
		expect.anything(),
	);
	await expect(
		sshConfig.update("dev.coder.com", BASE_SSH_VALUES),
	).rejects.toThrow(/Failed to write temporary SSH config file.*EACCES/);
});

it("cleans up temp file when rename fails", async () => {
	mockFileSystem.readFile.mockResolvedValueOnce("Host existing\n  HostName x");
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o600 });
	mockFileSystem.writeFile.mockResolvedValueOnce("");
	const err = new Error("EXDEV");
	(err as NodeJS.ErrnoException).code = "EXDEV";
	mockFileSystem.rename.mockRejectedValueOnce(err);

	const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
	await sshConfig.load();
	await expect(
		sshConfig.update("dev.coder.com", {
			...BASE_SSH_VALUES,
			ProxyCommand: "cmd",
		}),
	).rejects.toThrow(/Failed to rename temporary SSH config file/);
	expect(mockFileSystem.unlink).toHaveBeenCalledWith(
		expect.stringContaining(sshTempFilePrefix),
	);
});

describe("rename retry on Windows", () => {
	const realPlatform = process.platform;

	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "win32" });
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(process, "platform", { value: realPlatform });
	});

	it("retries on transient EPERM and succeeds", async () => {
		mockFileSystem.readFile.mockResolvedValueOnce(
			"Host existing\n  HostName x",
		);
		mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o600 });
		mockFileSystem.writeFile.mockResolvedValueOnce("");
		const err = new Error("EPERM");
		(err as NodeJS.ErrnoException).code = "EPERM";
		mockFileSystem.rename
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce(undefined);

		const sshConfig = new SshConfig(sshFilePath, mockLogger, mockFileSystem);
		await sshConfig.load();
		const promise = sshConfig.update("dev.coder.com", {
			...BASE_SSH_VALUES,
			ProxyCommand: "cmd",
		});

		await vi.advanceTimersByTimeAsync(100);
		await promise;

		expect(mockFileSystem.rename).toHaveBeenCalledTimes(2);
		expect(mockFileSystem.unlink).not.toHaveBeenCalled();
	});
});

describe("parseSshConfig", () => {
	interface ParseTest {
		name: string;
		input: string[];
		expected: Record<string, string>;
	}

	it.each<ParseTest>([
		{
			name: "space separator",
			input: ["Key value"],
			expected: { Key: "value" },
		},
		{
			name: "equals separator",
			input: ["Key=value"],
			expected: { Key: "value" },
		},
		{
			name: "SetEnv with space",
			input: ["SetEnv MY_VAR=value OTHER_VAR=othervalue"],
			expected: { SetEnv: "MY_VAR=value OTHER_VAR=othervalue" },
		},
		{
			name: "SetEnv with equals",
			input: ["SetEnv=MY_VAR=value OTHER_VAR=othervalue"],
			expected: { SetEnv: "MY_VAR=value OTHER_VAR=othervalue" },
		},
		{
			name: "accumulates SetEnv entries",
			input: ["SetEnv A=1", "setenv B=2 C=3"],
			expected: { SetEnv: "A=1 B=2 C=3" },
		},
		{
			name: "skips malformed lines",
			input: ["malformed", "# comment", "key=value", "  indented"],
			expected: { key: "value" },
		},
		{
			name: "value with spaces",
			input: ["ProxyCommand ssh -W %h:%p proxy"],
			expected: { ProxyCommand: "ssh -W %h:%p proxy" },
		},
		{
			name: "quoted value with spaces",
			input: ['SetEnv key="Hello world"'],
			expected: { SetEnv: 'key="Hello world"' },
		},
		{
			name: "multiple keys",
			input: ["ConnectTimeout 10", "LogLevel=DEBUG", "SetEnv VAR=1"],
			expected: { ConnectTimeout: "10", LogLevel: "DEBUG", SetEnv: "VAR=1" },
		},
		{
			name: "ignores empty SetEnv",
			input: ["SetEnv=", "SetEnv "],
			expected: {},
		},
	])("$name", ({ input, expected }) => {
		expect(parseSshConfig(input)).toEqual(expected);
	});
});

describe("mergeSshConfigValues", () => {
	interface MergeTest {
		name: string;
		config: Record<string, string>;
		overrides: Record<string, string>;
		expected: Record<string, string>;
	}

	it.each<MergeTest>([
		{
			name: "overrides case-insensitively",
			config: { LogLevel: "ERROR" },
			overrides: { loglevel: "DEBUG" },
			expected: { loglevel: "DEBUG" },
		},
		{
			name: "removes keys with empty string",
			config: { LogLevel: "ERROR", Foo: "bar" },
			overrides: { LogLevel: "" },
			expected: { Foo: "bar" },
		},
		{
			name: "adds new keys from overrides",
			config: { LogLevel: "ERROR" },
			overrides: { NewKey: "value" },
			expected: { LogLevel: "ERROR", NewKey: "value" },
		},
		{
			name: "preserves keys not in overrides",
			config: { A: "1", B: "2" },
			overrides: { B: "3" },
			expected: { A: "1", B: "3" },
		},
		{
			name: "concatenates SetEnv values",
			config: { SetEnv: "A=1" },
			overrides: { SetEnv: "B=2" },
			expected: { SetEnv: "A=1 B=2" },
		},
		{
			name: "concatenates SetEnv case-insensitively",
			config: { SetEnv: "A=1" },
			overrides: { setenv: "B=2" },
			expected: { SetEnv: "A=1 B=2" },
		},
		{
			name: "SetEnv only in override",
			config: {},
			overrides: { SetEnv: "B=2" },
			expected: { SetEnv: "B=2" },
		},
		{
			name: "SetEnv only in config",
			config: { SetEnv: "A=1" },
			overrides: {},
			expected: { SetEnv: "A=1" },
		},
		{
			name: "SetEnv with other values",
			config: { SetEnv: "A=1", LogLevel: "ERROR" },
			overrides: { SetEnv: "B=2", Timeout: "10" },
			expected: { SetEnv: "A=1 B=2", LogLevel: "ERROR", Timeout: "10" },
		},
		{
			name: "ignores empty SetEnv override",
			config: { SetEnv: "A=1 B=2" },
			overrides: { SetEnv: "" },
			expected: { SetEnv: "A=1 B=2" },
		},
	])("$name", ({ config, overrides, expected }) => {
		expect(mergeSshConfigValues(config, overrides)).toEqual(expected);
	});
});

describe("parseCoderSshOptions", () => {
	const coderBlock = (...lines: string[]) =>
		`# ------------START-CODER-----------\n${lines.join("\n")}\n# ------------END-CODER------------`;

	interface SshOptionTestCase {
		name: string;
		raw: string;
		expected: Record<string, string>;
	}
	it.each<SshOptionTestCase>([
		{
			name: "empty string",
			raw: "",
			expected: {},
		},
		{
			name: "no CLI block",
			raw: "Host myhost\n  HostName example.com",
			expected: {},
		},
		{
			name: "single option",
			raw: coderBlock("# :ssh-option=ForwardX11=yes"),
			expected: { ForwardX11: "yes" },
		},
		{
			name: "multiple options",
			raw: coderBlock(
				"# :ssh-option=ForwardX11=yes",
				"# :ssh-option=ForwardX11Trusted=yes",
			),
			expected: { ForwardX11: "yes", ForwardX11Trusted: "yes" },
		},
		{
			name: "ignores non-ssh-option keys",
			raw: coderBlock(
				"# :wait=yes",
				"# :disable-autostart=true",
				"# :ssh-option=ForwardX11=yes",
			),
			expected: { ForwardX11: "yes" },
		},
		{
			name: "accumulates SetEnv across lines",
			raw: coderBlock(
				"# :ssh-option=SetEnv=FOO=1",
				"# :ssh-option=SetEnv=BAR=2",
			),
			expected: { SetEnv: "FOO=1 BAR=2" },
		},
		{
			name: "tolerates different dash counts in markers",
			raw: `# ---START-CODER---\n# :ssh-option=ForwardX11=yes\n# ---END-CODER---`,
			expected: { ForwardX11: "yes" },
		},
	])("$name", ({ raw, expected }) => {
		expect(parseCoderSshOptions(raw)).toEqual(expected);
	});

	it("extracts only ssh-options from a full config", () => {
		const raw = `Host personal-server
  HostName 10.0.0.1
  User admin

# ------------START-CODER-----------
# This file is managed by coder. DO NOT EDIT.
#
# You should not hand-edit this file, changes may be overwritten.
# For more information, see https://coder.com/docs
#
# :wait=yes
# :disable-autostart=true
# :ssh-option=ForwardX11=yes
# :ssh-option=ForwardX11Trusted=yes

Host coder.mydeployment--*
  ConnectTimeout 0
  ForwardX11 yes
  ForwardX11Trusted yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
  ProxyCommand /usr/bin/coder ssh --stdio --ssh-host-prefix coder.mydeployment-- %h
# ------------END-CODER------------

Host work-server
  HostName 10.0.0.2
  User work`;
		expect(parseCoderSshOptions(raw)).toEqual({
			ForwardX11: "yes",
			ForwardX11Trusted: "yes",
		});
	});
});
