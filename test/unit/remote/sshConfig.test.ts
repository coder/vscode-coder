import { it, afterEach, vi, expect, describe } from "vitest";

import {
	SSHConfig,
	parseSshConfig,
	mergeSshConfigValues,
} from "@/remote/sshConfig";

// This is not the usual path to ~/.ssh/config, but
// setting it to a different path makes it easier to test
// and makes mistakes abundantly clear.
const sshFilePath = "/Path/To/UserHomeDir/.sshConfigDir/sshConfigFile";
const sshTempFilePathExpr = `^/Path/To/UserHomeDir/\\.sshConfigDir/\\.sshConfigFile\\.vscode-coder-tmp\\.[a-z0-9]+$`;

const mockFileSystem = {
	mkdir: vi.fn(),
	readFile: vi.fn(),
	rename: vi.fn(),
	stat: vi.fn(),
	writeFile: vi.fn(),
};

afterEach(() => {
	vi.clearAllMocks();
});

it("creates a new file and adds config with empty label", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("", {
		Host: "coder-vscode--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---`;

	expect(mockFileSystem.readFile).toBeCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		sshFilePath,
	);
});

it("creates a new file and adds the config", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev.coder.com--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.readFile).toBeCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev.coder.com--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev-updated.coder.com--*",
		ProxyCommand: "some-updated-command-here",
		ConnectTimeout: "1",
		StrictHostKeyChecking: "yes",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `${keepSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev-updated.coder.com--*
  ConnectTimeout 1
  LogLevel ERROR
  ProxyCommand some-updated-command-here
  StrictHostKeyChecking yes
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host *
  SetEnv TEST=1`;

	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev.coder.com--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		sshFilePath,
	);
});

it("it does not remove a user-added block that only matches the host of an old coder SSH config", async () => {
	const existentSSHConfig = `Host coder-vscode--*
  ForwardAgent=yes`;
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o644 });

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev.coder.com--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	const expectedOutput = `Host coder-vscode--*
  ForwardAgent=yes

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
	).rejects.toThrow(
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	await sshConfig.load();

	// When we try to update the config, it should throw an error.
	await expect(
		sshConfig.update("dev.coder.com", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
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

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
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

	await sshConfig.update("dev.coder.com", {
		Host: "coder-vscode.dev.coder.com--*",
		ProxyCommand: "some-command-here",
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "/dev/null",
		LogLevel: "ERROR",
	});

	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		{
			encoding: "utf-8",
			mode: 0o644,
		},
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		sshFilePath,
	);
});

it("override values", async () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	await sshConfig.load();
	await sshConfig.update(
		"dev.coder.com",
		{
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		},
		{
			loglevel: "DEBUG", // This tests case insensitive
			ConnectTimeout: "500",
			ExtraKey: "ExtraValue",
			Foo: "bar",
			Buzz: "baz",
			// Remove this key
			StrictHostKeyChecking: "",
			ExtraRemove: "",
		},
	);

	const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  Buzz baz
  ConnectTimeout 500
  ExtraKey ExtraValue
  Foo bar
  ProxyCommand some-command-here
  UserKnownHostsFile /dev/null
  loglevel DEBUG
# --- END CODER VSCODE dev.coder.com ---`;

	expect(mockFileSystem.readFile).toBeCalledWith(
		sshFilePath,
		expect.anything(),
	);
	expect(mockFileSystem.writeFile).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		expectedOutput,
		expect.objectContaining({
			encoding: "utf-8",
			mode: 0o600, // Default mode for new files.
		}),
	);
	expect(mockFileSystem.rename).toBeCalledWith(
		expect.stringMatching(sshTempFilePathExpr),
		sshFilePath,
	);
});

it("fails if we are unable to write the temporary file", async () => {
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before`;

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o600 });
	mockFileSystem.writeFile.mockRejectedValueOnce(new Error("EACCES"));

	await sshConfig.load();

	expect(mockFileSystem.readFile).toBeCalledWith(
		sshFilePath,
		expect.anything(),
	);
	await expect(
		sshConfig.update("dev.coder.com", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
	).rejects.toThrow(/Failed to write temporary SSH config file.*EACCES/);
});

it("fails if we are unable to rename the temporary file", async () => {
	const existentSSHConfig = `Host beforeconfig
  HostName before.config.tld
  User before`;

	const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
	mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig);
	mockFileSystem.stat.mockResolvedValueOnce({ mode: 0o600 });
	mockFileSystem.writeFile.mockResolvedValueOnce("");
	mockFileSystem.rename.mockRejectedValueOnce(new Error("EACCES"));

	await sshConfig.load();
	await expect(
		sshConfig.update("dev.coder.com", {
			Host: "coder-vscode.dev.coder.com--*",
			ProxyCommand: "some-command-here",
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		}),
	).rejects.toThrow(/Failed to rename temporary SSH config file.*EACCES/);
});

describe("parseSshConfig", () => {
	type ParseTest = {
		name: string;
		input: string[];
		expected: Record<string, string>;
	};

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
	type MergeTest = {
		name: string;
		config: Record<string, string>;
		overrides: Record<string, string>;
		expected: Record<string, string>;
	};

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
