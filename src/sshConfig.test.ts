/* eslint-disable @typescript-eslint/ban-ts-comment */
import { it, afterEach, vi, expect, describe, beforeEach } from "vitest";
import { SSHConfig } from "./sshConfig";
import { createMockFileSystem, createSSHConfigBlock } from "./test-helpers";

// Test constants
const sshFilePath = "/Path/To/UserHomeDir/.sshConfigDir/sshConfigFile";
const sshTempFilePathExpr = `^/Path/To/UserHomeDir/\\.sshConfigDir/\\.sshConfigFile\\.vscode-coder-tmp\\.[a-z0-9]+$`;

// Common SSH config options
const defaultSSHOptions = {
	ConnectTimeout: "0",
	LogLevel: "ERROR",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "/dev/null",
};

// Test helpers
let mockFileSystem: ReturnType<typeof createMockFileSystem>;

const setupNewFile = () => {
	mockFileSystem.readFile.mockRejectedValueOnce("No file found");
	mockFileSystem.stat.mockRejectedValueOnce({ code: "ENOENT" });
};

const setupExistingFile = (content: string, mode = 0o644) => {
	mockFileSystem.readFile.mockResolvedValueOnce(content);
	mockFileSystem.stat.mockResolvedValueOnce({ mode });
};

const createSSHOptions = (
	host: string,
	proxyCommand: string,
	overrides = {},
) => ({
	Host: host,
	ProxyCommand: proxyCommand,
	...defaultSSHOptions,
	...overrides,
});

describe("sshConfig", () => {
	beforeEach(() => {
		mockFileSystem = createMockFileSystem();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		["", "coder-vscode--*"],
		["dev.coder.com", "coder-vscode.dev.coder.com--*"],
	])("creates new file with config (label: %s)", async (label, host) => {
		setupNewFile();

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(label, createSSHOptions(host, "some-command-here"));

		const expectedOutput = createSSHConfigBlock(
			label,
			createSSHOptions(host, "some-command-here"),
		);

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			expect.objectContaining({
				encoding: "utf-8",
				mode: 0o600,
			}),
		);
		expect(mockFileSystem.rename).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			sshFilePath,
		);
	});

	it("adds config to existing file", async () => {
		const existingConfig = `Host coder.something
  ConnectTimeout=0
  LogLevel ERROR
  HostName coder.something
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null`;
		setupExistingFile(existingConfig);

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
		);

		const expectedOutput = `${existingConfig}

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
)}`;

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			{ encoding: "utf-8", mode: 0o644 },
		);
	});

	it("updates existing coder config", async () => {
		const keepConfig = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command

${createSSHConfigBlock(
	"dev2.coder.com",
	createSSHOptions("coder-vscode.dev2.coder.com--*", "some-command-here"),
)}`;

		const existingConfig = `${keepConfig}

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
)}

Host *
  SetEnv TEST=1`;

		setupExistingFile(existingConfig);

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions(
				"coder-vscode.dev-updated.coder.com--*",
				"some-updated-command-here",
				{ ConnectTimeout: "1", StrictHostKeyChecking: "yes" },
			),
		);

		const expectedOutput = `${keepConfig}

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions(
		"coder-vscode.dev-updated.coder.com--*",
		"some-updated-command-here",
		{ ConnectTimeout: "1", StrictHostKeyChecking: "yes" },
	),
)}

Host *
  SetEnv TEST=1`;

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			{ encoding: "utf-8", mode: 0o644 },
		);
	});

	it("preserves legacy deployment-unaware config", async () => {
		const existingConfig = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ConnectTimeout=0
  HostName coder.something
  LogLevel ERROR
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
# --- END CODER VSCODE ---`;
		setupExistingFile(existingConfig);

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
		);

		const expectedOutput = `${existingConfig}

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
)}`;

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			{ encoding: "utf-8", mode: 0o644 },
		);
	});

	it("preserves user-added blocks with matching host", async () => {
		const existingConfig = `Host coder-vscode--*
  ForwardAgent=yes`;
		setupExistingFile(existingConfig);

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
		);

		const expectedOutput = `Host coder-vscode--*
  ForwardAgent=yes

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
)}`;

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			{ encoding: "utf-8", mode: 0o644 },
		);
	});

	describe("error handling", () => {
		const errorCases = [
			{
				name: "missing end block",
				config: `Host beforeconfig
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
  User after`,
				label: "dev.coder.com",
				error: `Malformed config: ${sshFilePath} has an unterminated START CODER VSCODE dev.coder.com block. Each START block must have an END block.`,
			},
			{
				name: "duplicate sections",
				config: `Host beforeconfig
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
  User after`,
				label: "dev.coder.com",
				error: `Malformed config: ${sshFilePath} has 2 START CODER VSCODE dev.coder.com sections. Please remove all but one.`,
			},
		];

		it.each(errorCases)(
			"throws error for $name",
			async ({ config, label, error }) => {
				const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
				mockFileSystem.readFile.mockResolvedValueOnce(config);
				await sshConfig.load();

				await expect(
					sshConfig.update(
						label,
						createSSHOptions(
							"coder-vscode.dev.coder.com--*",
							"some-command-here",
						),
					),
				).rejects.toThrow(error);
			},
		);

		it("throws error for mismatched blocks without label", async () => {
			const config = `Host beforeconfig
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
			mockFileSystem.readFile.mockResolvedValueOnce(config);
			await sshConfig.load();

			await expect(
				sshConfig.update(
					"",
					createSSHOptions(
						"coder-vscode.dev.coder.com--*",
						"some-command-here",
					),
				),
			).rejects.toThrow(
				`Malformed config: ${sshFilePath} has an unterminated START CODER VSCODE block. Each START block must have an END block.`,
			);
		});
	});

	it("handles interspersed blocks correctly", async () => {
		const existingConfig = `Host beforeconfig
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

${createSSHConfigBlock(
	"dev.coder.com",
	createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
)}

Host afterconfig
  HostName after.config.tld
  User after`;

		setupExistingFile(existingConfig);

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
		);

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			existingConfig,
			{ encoding: "utf-8", mode: 0o644 },
		);
	});

	it("handles option overrides", async () => {
		setupNewFile();

		const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
		await sshConfig.load();
		await sshConfig.update(
			"dev.coder.com",
			createSSHOptions("coder-vscode.dev.coder.com--*", "some-command-here"),
			{
				loglevel: "DEBUG", // Tests case insensitive
				ConnectTimeout: "500",
				ExtraKey: "ExtraValue",
				Foo: "bar",
				Buzz: "baz",
				StrictHostKeyChecking: "", // Remove this key
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

		expect(mockFileSystem.writeFile).toBeCalledWith(
			expect.stringMatching(sshTempFilePathExpr),
			expectedOutput,
			expect.objectContaining({
				encoding: "utf-8",
				mode: 0o600,
			}),
		);
	});

	describe("file operation failures", () => {
		const existingConfig = `Host beforeconfig
  HostName before.config.tld
  User before`;

		it.each([
			[
				"write failure",
				() =>
					mockFileSystem.writeFile.mockRejectedValueOnce(new Error("EACCES")),
				/Failed to write temporary SSH config file.*EACCES/,
			],
			[
				"rename failure",
				() => {
					mockFileSystem.writeFile.mockResolvedValueOnce("");
					mockFileSystem.rename.mockRejectedValueOnce(new Error("EACCES"));
				},
				/Failed to rename temporary SSH config file.*EACCES/,
			],
		])("handles %s", async (_, setupMock, errorPattern) => {
			const sshConfig = new SSHConfig(sshFilePath, mockFileSystem);
			setupExistingFile(existingConfig, 0o600);
			setupMock();

			await sshConfig.load();
			await expect(
				sshConfig.update(
					"dev.coder.com",
					createSSHOptions(
						"coder-vscode.dev.coder.com--*",
						"some-command-here",
					),
				),
			).rejects.toThrow(errorPattern);
		});
	});
});
