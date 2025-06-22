import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Remote } from "./remote";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("axios", () => ({
	default: {
		create: vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		})),
	},
	isAxiosError: vi.fn(),
}));
vi.mock("coder/site/src/api/api", () => ({
	Api: class MockApi {
		setHost = vi.fn();
		setSessionToken = vi.fn();
		getAxiosInstance = vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		}));
	},
}));
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./cliManager");
vi.mock("./commands");
vi.mock("./featureSet");
vi.mock("./headers");
vi.mock("./inbox");
vi.mock("./sshConfig");
vi.mock("./sshSupport");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspaceMonitor");
vi.mock("fs/promises");
vi.mock("os");
vi.mock("pretty-bytes", () => ({
	default: vi.fn((bytes) => `${bytes}B`),
}));
vi.mock("find-process", () => ({
	default: vi.fn(),
}));

// Mock vscode module
vi.mock("vscode", () => ({
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	ProgressLocation: {
		Notification: 15,
		SourceControl: 1,
		Window: 10,
	},
	StatusBarAlignment: {
		Left: 1,
		Right: 2,
	},
	window: {
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			show: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
	EventEmitter: class MockEventEmitter {
		fire = vi.fn();
		event = vi.fn();
		dispose = vi.fn();
	},
	commands: {
		executeCommand: vi.fn(),
	},
}));

describe("remote", () => {
	let mockVscodeProposed: typeof vscode;
	let mockStorage: Storage;
	let mockCommands: Commands;
	let remote: Remote;

	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks();

		// Create mock instances
		mockVscodeProposed = {
			window: {
				showInformationMessage: vi.fn(),
				showErrorMessage: vi.fn(),
				withProgress: vi.fn().mockImplementation((options, task) => {
					// Execute the task immediately with a mock progress object
					return task({ report: vi.fn() }, { isCancellationRequested: false });
				}),
				createStatusBarItem: vi.fn(),
			},
			workspace: {
				getConfiguration: vi.fn().mockReturnValue({
					get: vi.fn(),
				}),
				registerResourceLabelFormatter: vi.fn(),
			},
		} as unknown as typeof vscode;

		mockStorage = {
			getSessionTokenPath: vi.fn().mockReturnValue("/mock/session/path"),
			writeToCoderOutputChannel: vi.fn(),
			migrateSessionToken: vi.fn().mockResolvedValue(undefined),
			readCliConfig: vi.fn().mockResolvedValue({ url: "", token: "" }),
			getRemoteSSHLogPath: vi.fn().mockResolvedValue(undefined),
			fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
			getNetworkInfoPath: vi.fn().mockReturnValue("/mock/network/info"),
		} as unknown as Storage;
		mockCommands = {} as Commands;
	});

	it("should export Remote class", () => {
		expect(typeof Remote).toBe("function");
		expect(Remote.prototype.constructor).toBe(Remote);
	});

	it("should create a Remote instance with required dependencies", () => {
		remote = new Remote(
			mockVscodeProposed,
			mockStorage,
			mockCommands,
			vscode.ExtensionMode.Production,
		);

		expect(remote).toBeInstanceOf(Remote);
		expect(remote).toHaveProperty("confirmStart");
		expect(remote).toHaveProperty("setup");
		expect(remote).toHaveProperty("closeRemote");
		expect(remote).toHaveProperty("reloadWindow");
	});

	describe("confirmStart", () => {
		it("should show information message and return true when user confirms", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockShowInformationMessage = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			mockShowInformationMessage.mockResolvedValue("Start");

			// Access private method using bracket notation to avoid any
			const result = await remote["confirmStart"]("test-workspace");

			expect(mockShowInformationMessage).toHaveBeenCalledWith(
				"Unable to connect to the workspace test-workspace because it is not running. Start the workspace?",
				{
					useCustom: true,
					modal: true,
				},
				"Start",
			);
			expect(result).toBe(true);
		});

		it("should return false when user cancels", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockShowInformationMessage = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			mockShowInformationMessage.mockResolvedValue(undefined);

			// Access private method using bracket notation to avoid any
			const result = await remote["confirmStart"]("test-workspace");

			expect(result).toBe(false);
		});
	});

	describe("closeRemote", () => {
		it("should execute workbench.action.remote.close command", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			await remote.closeRemote();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.remote.close",
			);
		});
	});

	describe("reloadWindow", () => {
		it("should execute workbench.action.reloadWindow command", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			await remote.reloadWindow();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.reloadWindow",
			);
		});
	});

	describe("findSSHProcessID", () => {
		it("should return undefined when no remote SSH log path exists", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock storage to return undefined for SSH log path
			mockStorage.getRemoteSSHLogPath = vi.fn().mockResolvedValue(undefined);

			// Access private method using bracket notation
			const result = await remote["findSSHProcessID"](100); // Short timeout for test

			expect(result).toBeUndefined();
			expect(mockStorage.getRemoteSSHLogPath).toHaveBeenCalled();
		});
	});

	describe("maybeWaitForRunning", () => {
		it("should return undefined when user cancels workspace start", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock API client using the mocked Api class from the top
			const mockRestClient = {
				getWorkspaceByOwnerAndName: vi.fn(),
			} as never;

			// Mock workspace with minimal required properties
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				latest_build: {
					status: "stopped",
				},
			} as never;

			// Mock confirmStart to return false (user cancels)
			const mockShowInformationMessage = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			mockShowInformationMessage.mockResolvedValue(undefined);

			// Access private method using bracket notation
			const result = await remote["maybeWaitForRunning"](
				mockRestClient,
				mockWorkspace,
				"test-label",
				"/path/to/bin",
			);

			expect(result).toBeUndefined();
			expect(mockShowInformationMessage).toHaveBeenCalled();
		});
	});

	describe("setup", () => {
		it("should return undefined for non-coder host", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return null (not a Coder host)
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue(null);

			// Call setup with a non-coder remote authority
			const result = await remote.setup("non-coder-host");

			expect(result).toBeUndefined();
			expect(parseRemoteAuthority).toHaveBeenCalledWith("non-coder-host");
		});

		it("should close remote when user declines to log in", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue({
				host: "test.coder.com",
				label: "test-label",
				username: "test-user",
				workspace: "test-workspace",
				agent: undefined,
			});

			// Mock storage to return empty config (not logged in)
			vi.mocked(mockStorage.migrateSessionToken).mockResolvedValue();
			vi.mocked(mockStorage.readCliConfig).mockResolvedValue({
				url: "",
				token: "",
			});

			// Mock needToken to return true
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(true);

			// Mock showInformationMessage to return undefined (user declined)
			const showInfoMessageSpy = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			showInfoMessageSpy.mockResolvedValue(undefined);

			// Mock closeRemote
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			await remote.setup("coder-vscode--test-label--test-user--test-workspace");

			expect(closeRemoteSpy).toHaveBeenCalled();
			expect(showInfoMessageSpy).toHaveBeenCalledWith(
				"You are not logged in...",
				expect.objectContaining({
					detail: "You must log in to access test-user/test-workspace.",
				}),
				"Log In",
			);
		});

		it("should show error and close remote for incompatible server version", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue({
				host: "test.coder.com",
				label: "test-label",
				username: "test-user",
				workspace: "test-workspace",
				agent: undefined,
			});

			// Mock storage to return valid config
			vi.mocked(mockStorage.migrateSessionToken).mockResolvedValue();
			vi.mocked(mockStorage.readCliConfig).mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock makeCoderSdk
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.13.0" }),
			} as never;
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockWorkspaceRestClient);

			// Mock storage.fetchBinary
			vi.mocked(mockStorage.fetchBinary).mockResolvedValue("/path/to/coder");

			// Mock cli.version to return old version
			const cli = await import("./cliManager");
			vi.mocked(cli.version).mockResolvedValue("v0.13.0");

			// Mock featureSetForVersion to return featureSet without vscodessh
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValue({
				vscodessh: false,
			} as never);

			// Mock showErrorMessage
			const showErrorMessageSpy = mockVscodeProposed.window
				.showErrorMessage as ReturnType<typeof vi.fn>;
			showErrorMessageSpy.mockResolvedValue("Close Remote");

			// Mock closeRemote
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			const result = await remote.setup(
				"coder-vscode--test-label--test-user--test-workspace",
			);

			expect(result).toBeUndefined();
			expect(showErrorMessageSpy).toHaveBeenCalledWith(
				"Incompatible Server",
				expect.objectContaining({
					detail: expect.stringContaining(
						"Your Coder server is too old to support the Coder extension",
					),
				}),
				"Close Remote",
			);
			expect(closeRemoteSpy).toHaveBeenCalled();
		});

		it("should handle workspace not found (404) error", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue({
				host: "test.coder.com",
				label: "test-label",
				username: "test-user",
				workspace: "test-workspace",
				agent: undefined,
			});

			// Mock storage to return valid config
			vi.mocked(mockStorage.migrateSessionToken).mockResolvedValue();
			vi.mocked(mockStorage.readCliConfig).mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock makeCoderSdk
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.15.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockRejectedValue({
					isAxiosError: true,
					response: { status: 404 },
				}),
			} as never;
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockWorkspaceRestClient);

			// Mock cli.version to return compatible version
			const cli = await import("./cliManager");
			vi.mocked(cli.version).mockResolvedValue("v0.15.0");

			// Mock featureSetForVersion to return featureSet with vscodessh
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValue({
				vscodessh: true,
			} as never);

			// Mock showInformationMessage for workspace not found
			const showInfoMessageSpy = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			showInfoMessageSpy.mockResolvedValue(undefined); // User cancels

			// Mock closeRemote
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			// Mock commands.executeCommand
			const executeCommandSpy = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandSpy,
			);

			// Mock isAxiosError
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			const result = await remote.setup(
				"coder-vscode--test-label--test-user--test-workspace",
			);

			expect(result).toBeUndefined();
			expect(showInfoMessageSpy).toHaveBeenCalledWith(
				"That workspace doesn't exist!",
				expect.objectContaining({
					modal: true,
					detail: expect.stringContaining(
						"test-user/test-workspace cannot be found",
					),
				}),
				"Open Workspace",
			);
			expect(closeRemoteSpy).toHaveBeenCalled();
			expect(executeCommandSpy).toHaveBeenCalledWith("coder.open");
		});

		it("should handle session expired (401) error", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue({
				host: "test.coder.com",
				label: "test-label",
				username: "test-user",
				workspace: "test-workspace",
				agent: undefined,
			});

			// Mock storage to return valid config
			vi.mocked(mockStorage.migrateSessionToken).mockResolvedValue();
			vi.mocked(mockStorage.readCliConfig).mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock makeCoderSdk
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.15.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockRejectedValue({
					isAxiosError: true,
					response: { status: 401 },
				}),
			} as never;
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockWorkspaceRestClient);

			// Mock cli.version to return compatible version
			const cli = await import("./cliManager");
			vi.mocked(cli.version).mockResolvedValue("v0.15.0");

			// Mock featureSetForVersion to return featureSet with vscodessh
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValue({
				vscodessh: true,
			} as never);

			// Mock showInformationMessage for session expired
			const showInfoMessageSpy = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			showInfoMessageSpy.mockResolvedValue("Log In");

			// Mock commands.executeCommand
			const executeCommandSpy = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandSpy,
			);

			// Mock isAxiosError
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			// Track recursive setup call
			let setupCallCount = 0;
			const originalSetup = remote.setup.bind(remote);
			remote.setup = vi.fn(async (authority) => {
				setupCallCount++;
				if (setupCallCount === 1) {
					// First call - run the actual implementation
					return originalSetup(authority);
				} else {
					// Second call (after login) - return success
					return {
						url: "https://test.coder.com",
						token: "test-token",
						dispose: vi.fn(),
					} as never;
				}
			});

			const result = await remote.setup(
				"coder-vscode--test-label--test-user--test-workspace",
			);

			expect(result).toBeUndefined();
			expect(showInfoMessageSpy).toHaveBeenCalledWith(
				"Your session expired...",
				expect.objectContaining({
					modal: true,
					detail: expect.stringContaining(
						"You must log in to access test-user/test-workspace",
					),
				}),
				"Log In",
			);
			expect(executeCommandSpy).toHaveBeenCalledWith(
				"coder.login",
				"https://test.coder.com",
				undefined,
				"test-label",
			);
			// Should call setup again after login
			expect(setupCallCount).toBe(2);
		});

		it("should use development binary path when in development mode", async () => {
			// Create remote in development mode
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValue({
				host: "test.coder.com",
				label: "test-label",
				username: "test-user",
				workspace: "test-workspace",
				agent: undefined,
			});

			// Mock storage to return valid config
			vi.mocked(mockStorage.migrateSessionToken).mockResolvedValue();
			vi.mocked(mockStorage.readCliConfig).mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock fs.stat to simulate /tmp/coder exists
			const fs = await import("fs/promises");
			vi.mocked(fs.stat).mockResolvedValue({} as never);

			// Mock makeCoderSdk to return workspace not found to exit early
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.15.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockRejectedValue({
					isAxiosError: true,
					response: { status: 404 },
				}),
			} as never;
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockWorkspaceRestClient);

			// Mock cli.version to return compatible version
			const cli = await import("./cliManager");
			vi.mocked(cli.version).mockResolvedValue("v0.15.0");

			// Mock featureSetForVersion to return featureSet with vscodessh
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValue({
				vscodessh: true,
			} as never);

			// Mock showInformationMessage to cancel
			const showInfoMessageSpy = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			showInfoMessageSpy.mockResolvedValue(undefined);

			// Mock closeRemote
			const _closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			// Mock commands.executeCommand
			const executeCommandSpy = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandSpy,
			);

			// Mock isAxiosError
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			// Mock os.tmpdir to ensure we're checking the right path
			const os = await import("os");
			vi.mocked(os.tmpdir).mockReturnValue("/tmp");

			await remote.setup("coder-vscode--test-label--test-user--test-workspace");

			// Verify that fs.stat was called with the development binary path
			expect(fs.stat).toHaveBeenCalledWith("/tmp/coder");
			// Verify that fetchBinary was not called because development binary exists
			expect(mockStorage.fetchBinary).not.toHaveBeenCalled();
		});
	});

	describe("getLogDir", () => {
		it("should return empty string when feature is not supported", () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = {
				proxyLogDirectory: false,
			} as never;

			// Access private method using bracket notation
			const result = remote["getLogDir"](featureSet);

			expect(result).toBe("");
			expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
		});

		it("should return empty string when config is not set", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = {
				proxyLogDirectory: true,
			} as never;

			// Mock getConfiguration to return undefined
			const mockConfig = {
				get: vi.fn().mockReturnValue(undefined),
			};
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				mockConfig as never,
			);

			// Mock expandPath to return empty string for empty/undefined input
			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockReturnValue("");

			// Access private method using bracket notation
			const result = remote["getLogDir"](featureSet);

			expect(result).toBe("");
			expect(mockConfig.get).toHaveBeenCalledWith("coder.proxyLogDirectory");
		});

		it("should return expanded path when config is set", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = {
				proxyLogDirectory: true,
			} as never;

			// Mock getConfiguration to return a path
			const mockConfig = {
				get: vi.fn().mockReturnValue("~/logs/coder"),
			};
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				mockConfig as never,
			);

			// Mock expandPath
			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockReturnValue("/home/user/logs/coder");

			// Access private method using bracket notation
			const result = remote["getLogDir"](featureSet);

			expect(result).toBe("/home/user/logs/coder");
			expect(mockConfig.get).toHaveBeenCalledWith("coder.proxyLogDirectory");
			expect(expandPath).toHaveBeenCalledWith("~/logs/coder");
		});
	});

	describe("formatLogArg", () => {
		it("should return empty string when logDir is empty", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Access private method using bracket notation
			const result = await remote["formatLogArg"]("");

			expect(result).toBe("");
			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalled();
		});

		it("should create directory and return formatted arg when logDir is provided", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock fs.mkdir
			const fs = await import("fs/promises");
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);

			// Access private method using bracket notation
			const result = await remote["formatLogArg"]("/path/to/logs");

			expect(fs.mkdir).toHaveBeenCalledWith("/path/to/logs", {
				recursive: true,
			});
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"SSH proxy diagnostics are being written to /path/to/logs",
			);
			expect(result).toBe(" --log-dir /path/to/logs");
		});
	});

	describe("registerLabelFormatter", () => {
		it("should register label formatter with workspace only", () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock registerResourceLabelFormatter
			const disposable = { dispose: vi.fn() };
			mockVscodeProposed.workspace.registerResourceLabelFormatter = vi
				.fn()
				.mockReturnValue(disposable);

			// Access private method using bracket notation
			const result = remote["registerLabelFormatter"](
				"test-authority",
				"test-owner",
				"test-workspace",
			);

			expect(
				mockVscodeProposed.workspace.registerResourceLabelFormatter,
			).toHaveBeenCalledWith({
				scheme: "vscode-remote",
				authority: "test-authority",
				formatting: {
					label: "${path}",
					separator: "/",
					tildify: true,
					workspaceSuffix: "Coder: test-owner∕test-workspace",
				},
			});
			expect(result).toBe(disposable);
		});

		it("should register label formatter with workspace and agent", () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock registerResourceLabelFormatter
			const disposable = { dispose: vi.fn() };
			mockVscodeProposed.workspace.registerResourceLabelFormatter = vi
				.fn()
				.mockReturnValue(disposable);

			// Access private method using bracket notation
			const result = remote["registerLabelFormatter"](
				"test-authority",
				"test-owner",
				"test-workspace",
				"test-agent",
			);

			expect(
				mockVscodeProposed.workspace.registerResourceLabelFormatter,
			).toHaveBeenCalledWith({
				scheme: "vscode-remote",
				authority: "test-authority",
				formatting: {
					label: "${path}",
					separator: "/",
					tildify: true,
					workspaceSuffix: "Coder: test-owner∕test-workspace∕test-agent",
				},
			});
			expect(result).toBe(disposable);
		});
	});

	describe("showNetworkUpdates", () => {
		it("should create status bar item and show network status", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock createStatusBarItem on the vscode module
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(
				mockStatusBarItem as never,
			);

			// Mock fs.readFile to return network info
			const fs = await import("fs/promises");
			const networkInfo = {
				p2p: true,
				latency: 25.5,
				preferred_derp: "us-east",
				derp_latency: { "us-east": 10.5 },
				upload_bytes_sec: 1024,
				download_bytes_sec: 2048,
				using_coder_connect: false,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkInfo));

			// Access private method using bracket notation
			const disposable = remote["showNetworkUpdates"](12345);

			// Wait for the periodic refresh to run at least once
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify status bar was created
			expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
				vscode.StatusBarAlignment.Left,
				1000,
			);

			// Verify status bar item was updated
			expect(mockStatusBarItem.text).toBe("$(globe) Direct (25.50ms)");
			expect(mockStatusBarItem.tooltip).toContain("peer-to-peer");
			expect(mockStatusBarItem.show).toHaveBeenCalled();

			// Cleanup
			disposable.dispose();
			expect(mockStatusBarItem.dispose).toHaveBeenCalled();
		});

		it("should show Coder Connect status when using Coder Connect", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock createStatusBarItem on the vscode module
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(
				mockStatusBarItem as never,
			);

			// Mock fs.readFile to return network info with Coder Connect
			const fs = await import("fs/promises");
			const networkInfo = {
				p2p: false,
				latency: 0,
				preferred_derp: "",
				derp_latency: {},
				upload_bytes_sec: 0,
				download_bytes_sec: 0,
				using_coder_connect: true,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkInfo));

			// Access private method using bracket notation
			const disposable = remote["showNetworkUpdates"](12345);

			// Wait for the periodic refresh to run at least once
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify Coder Connect status
			expect(mockStatusBarItem.text).toBe("$(globe) Coder Connect ");
			expect(mockStatusBarItem.tooltip).toBe(
				"You're connected using Coder Connect.",
			);
			expect(mockStatusBarItem.show).toHaveBeenCalled();

			// Cleanup
			disposable.dispose();
		});

		it("should show relay status when not p2p", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock createStatusBarItem on the vscode module
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(
				mockStatusBarItem as never,
			);

			// Mock fs.readFile to return network info with relay
			const fs = await import("fs/promises");
			const networkInfo = {
				p2p: false,
				latency: 50.0,
				preferred_derp: "us-west",
				derp_latency: {
					"us-west": 20.0,
					"us-east": 30.0,
					"eu-west": 100.0,
				},
				upload_bytes_sec: 5120,
				download_bytes_sec: 10240,
				using_coder_connect: false,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkInfo));

			// Access private method using bracket notation
			const disposable = remote["showNetworkUpdates"](12345);

			// Wait for the periodic refresh to run at least once
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify relay status
			expect(mockStatusBarItem.text).toBe("$(globe) us-west (50.00ms)");
			expect(mockStatusBarItem.tooltip).toContain("connected through a relay");
			expect(mockStatusBarItem.tooltip).toContain("You ↔ 20.00ms ↔ us-west");
			expect(mockStatusBarItem.tooltip).toContain("Other regions:");
			expect(mockStatusBarItem.tooltip).toContain("us-east: 30ms");
			expect(mockStatusBarItem.tooltip).toContain("eu-west: 100ms");
			expect(mockStatusBarItem.show).toHaveBeenCalled();

			// Cleanup
			disposable.dispose();
		});

		it("should handle file read errors gracefully", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock createStatusBarItem on the vscode module
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(
				mockStatusBarItem as never,
			);

			// Mock fs.readFile to reject
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

			// Access private method using bracket notation
			const disposable = remote["showNetworkUpdates"](12345);

			// Wait for the periodic refresh to run at least once
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify status bar was created but not updated
			expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
			expect(mockStatusBarItem.show).not.toHaveBeenCalled();

			// Cleanup
			disposable.dispose();
		});
	});

	describe("reloadWindow", () => {
		it("should execute workbench.action.reloadWindow command", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			await remote.reloadWindow();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.reloadWindow",
			);
		});
	});

	describe("findSSHProcessID", () => {
		it("should return undefined when no log path is found", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getRemoteSSHLogPath to return undefined
			vi.mocked(mockStorage.getRemoteSSHLogPath).mockResolvedValue(undefined);

			// Access private method using bracket notation
			const result = await remote["findSSHProcessID"](100);

			expect(result).toBeUndefined();
		});

		it("should return process ID when found in log", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getRemoteSSHLogPath
			vi.mocked(mockStorage.getRemoteSSHLogPath).mockResolvedValue(
				"/path/to/log",
			);

			// Mock fs.readFile to return log with port
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue(
				"SSH connection established on port 12345",
			);

			// Mock findPort
			const { findPort } = await import("./util");
			vi.mocked(findPort).mockResolvedValue(12345);

			// Mock find-process
			const findProcess = await import("find-process");
			vi.mocked(findProcess.default).mockResolvedValue([
				{
					pid: 98765,
					ppid: 1,
					uid: 1000,
					gid: 1000,
					name: "ssh",
					cmd: "ssh command",
				},
			]);

			// Access private method using bracket notation
			const result = await remote["findSSHProcessID"](1000);

			expect(result).toBe(98765);
			expect(findPort).toHaveBeenCalledWith(
				"SSH connection established on port 12345",
			);
			expect(findProcess.default).toHaveBeenCalledWith("port", 12345);
		});

		it("should timeout when process not found in time", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getRemoteSSHLogPath to return undefined repeatedly
			vi.mocked(mockStorage.getRemoteSSHLogPath).mockResolvedValue(undefined);

			// Access private method using bracket notation with short timeout
			const result = await remote["findSSHProcessID"](50);

			expect(result).toBeUndefined();
		});

		it("should return undefined when no port found in log", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getRemoteSSHLogPath
			vi.mocked(mockStorage.getRemoteSSHLogPath).mockResolvedValue(
				"/path/to/log",
			);

			// Mock fs.readFile to return log without port
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue("No port info in this log");

			// Mock findPort to return null
			const { findPort } = await import("./util");
			vi.mocked(findPort).mockResolvedValue(null);

			// Access private method using bracket notation with short timeout
			const result = await remote["findSSHProcessID"](50);

			expect(result).toBeUndefined();
			expect(findPort).toHaveBeenCalledWith("No port info in this log");
		});

		it("should return undefined when no processes found for port", async () => {
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getRemoteSSHLogPath
			vi.mocked(mockStorage.getRemoteSSHLogPath).mockResolvedValue(
				"/path/to/log",
			);

			// Mock fs.readFile to return log with port
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue("SSH on port 9999");

			// Mock findPort
			const { findPort } = await import("./util");
			vi.mocked(findPort).mockResolvedValue(9999);

			// Mock find-process to return empty array
			const findProcess = await import("find-process");
			vi.mocked(findProcess.default).mockResolvedValue([]);

			// Access private method using bracket notation
			const result = await remote["findSSHProcessID"](1000);

			expect(result).toBeUndefined();
			expect(findProcess.default).toHaveBeenCalledWith("port", 9999);
		});
	});
});
