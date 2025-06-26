import * as fs from "fs/promises";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Remote } from "./remote";
import { Storage } from "./storage";
import { createMockStorage, createMockWorkspace } from "./test-helpers";

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
	isAxiosError: vi.fn((error) => error.isAxiosError === true),
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
vi.mock("./cliManager", () => ({
	version: vi.fn().mockResolvedValue("v2.0.0"),
}));
vi.mock("./commands");
vi.mock("./featureSet", () => ({
	featureSetForVersion: vi.fn(() => ({
		vscodessh: true,
		proxyLogDirectory: true,
		wildcardSSH: true,
	})),
}));
vi.mock("./headers");
vi.mock("./inbox");
vi.mock("./sshConfig");
vi.mock("./sshSupport");
// Don't mock storage - we'll create real instances in tests
// vi.mock("./storage");
vi.mock("./util", () => ({
	parseRemoteAuthority: vi.fn().mockReturnValue(null),
	expandPath: vi.fn((path) => path),
	findPort: vi.fn(),
}));
vi.mock("./workspaceMonitor");
vi.mock("fs/promises", async () => {
	const actual = (await vi.importActual(
		"fs/promises",
	)) as typeof import("fs/promises");
	return {
		...actual,
		stat: vi.fn(),
		readFile: vi.fn(),
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		readdir: vi.fn(),
	};
});
vi.mock("os", () => ({
	tmpdir: vi.fn(() => "/tmp"),
}));
vi.mock("pretty-bytes", () => ({
	default: vi.fn((bytes) => `${bytes}B`),
}));
vi.mock("find-process", () => ({
	default: vi.fn(),
}));
vi.mock("jsonc-parser", () => ({
	applyEdits: vi.fn((content, edits) => {
		// Simple mock that returns JSON with the expected modifications
		const obj = JSON.parse(content || "{}");
		// Apply edits in a simplified way for testing
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		edits.forEach((edit: any) => {
			if (edit.path && edit.value !== undefined) {
				const keys = edit.path;
				let current = obj;
				for (let i = 0; i < keys.length - 1; i++) {
					if (!current[keys[i]]) {
						current[keys[i]] = {};
					}
					current = current[keys[i]];
				}
				current[keys[keys.length - 1]] = edit.value;
			}
		});
		return JSON.stringify(obj);
	}),
	modify: vi.fn((content, path, value) => {
		// Return a mock edit operation
		return [{ path, value }];
	}),
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
	TerminalLocation: {
		Panel: 1,
		Editor: 2,
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
		createTerminal: vi.fn(() => ({
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
	ThemeIcon: class MockThemeIcon {
		constructor(public id: string) {}
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
				createTerminal: vi.fn(),
			},
			workspace: {
				getConfiguration: vi.fn().mockReturnValue({
					get: vi.fn(),
				}),
				registerResourceLabelFormatter: vi.fn(),
			},
			commands: {
				executeCommand: vi.fn(),
			},
			ExtensionMode: vscode.ExtensionMode,
			ProgressLocation: vscode.ProgressLocation,
			TerminalLocation: vscode.TerminalLocation,
			ThemeIcon: vscode.ThemeIcon,
			EventEmitter: vscode.EventEmitter,
		} as unknown as typeof vscode;

		// Create mock storage with overrides
		mockStorage = createMockStorage({
			getSessionTokenPath: vi.fn().mockReturnValue("/mock/session/path"),
			writeToCoderOutputChannel: vi.fn(),
			migrateSessionToken: vi.fn().mockResolvedValue(undefined),
			readCliConfig: vi.fn().mockResolvedValue({ url: "", token: "" }),
			getRemoteSSHLogPath: vi.fn().mockResolvedValue(undefined),
			fetchBinary: vi.fn().mockResolvedValue("/path/to/binary"),
			getNetworkInfoPath: vi.fn().mockReturnValue("/mock/network/info"),
		});
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

	describe("handleAuthentication", () => {
		it("should migrate session token and return credentials when valid", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock successful token migration and config read
			mockStorage.migrateSessionToken = vi.fn().mockResolvedValue(undefined);
			mockStorage.readCliConfig = vi.fn().mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).handleAuthentication(
				{
					label: "test",
					username: "user",
					workspace: "workspace",
					agent: undefined,
					host: "test-host",
				},
				"user/workspace",
			);

			expect(mockStorage.migrateSessionToken).toHaveBeenCalledWith("test");
			expect(mockStorage.readCliConfig).toHaveBeenCalledWith("test");
			expect(result).toEqual({
				url: "https://test.coder.com",
				token: "test-token",
			});
		});

		it("should prompt for login when no URL or token found", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			mockStorage.migrateSessionToken = vi.fn().mockResolvedValue(undefined);
			mockStorage.readCliConfig = vi.fn().mockResolvedValue({
				url: "",
				token: "",
			});

			mockVscodeProposed.window.showInformationMessage = vi
				.fn()
				.mockResolvedValue("Log In");

			const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).handleAuthentication(
				{
					label: "test",
					username: "user",
					workspace: "workspace",
					agent: undefined,
					host: "test-host",
				},
				"user/workspace",
			);

			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"You are not logged in...",
				{
					useCustom: true,
					modal: true,
					detail: "You must log in to access user/workspace.",
				},
				"Log In",
			);
			expect(executeCommandSpy).toHaveBeenCalledWith(
				"coder.login",
				"",
				undefined,
				"test",
			);
			expect(result).toBeUndefined();
		});
	});

	describe("validateWorkspaceAccess", () => {
		it("should validate server version and fetch workspace successfully", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockResolvedValue({
					name: "workspace",
					owner_name: "user",
					latest_build: { status: "running" },
				}),
			};

			const mockBinaryPath = "/path/to/coder";
			const mockParts = {
				label: "test",
				username: "user",
				workspace: "workspace",
				agent: undefined,
				host: "test-host",
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateWorkspaceAccess(
				mockRestClient,
				mockBinaryPath,
				mockParts,
				"user/workspace",
				"https://test.coder.com",
			);

			expect(mockRestClient.getBuildInfo).toHaveBeenCalled();
			expect(mockRestClient.getWorkspaceByOwnerAndName).toHaveBeenCalledWith(
				"user",
				"workspace",
			);
			expect(result).toEqual({
				workspace: {
					name: "workspace",
					owner_name: "user",
					latest_build: { status: "running" },
				},
				featureSet: expect.objectContaining({ vscodessh: true }),
			});
		});

		it("should show error and close remote for incompatible server version", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.13.0" }),
			};

			// Mock featureSetForVersion to return vscodessh: false for old version
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValueOnce({
				vscodessh: false,
				proxyLogDirectory: false,
				wildcardSSH: false,
			});

			mockVscodeProposed.window.showErrorMessage = vi
				.fn()
				.mockResolvedValue("Close Remote");

			const closeRemoteSpy = vi.spyOn(remote, "closeRemote");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateWorkspaceAccess(
				mockRestClient,
				"/path/to/coder",
				{
					label: "test",
					username: "user",
					workspace: "workspace",
					agent: undefined,
					host: "test-host",
				},
				"user/workspace",
				"https://test.coder.com",
			);

			expect(mockVscodeProposed.window.showErrorMessage).toHaveBeenCalledWith(
				"Incompatible Server",
				{
					detail:
						"Your Coder server is too old to support the Coder extension! Please upgrade to v0.14.1 or newer.",
					modal: true,
					useCustom: true,
				},
				"Close Remote",
			);
			expect(closeRemoteSpy).toHaveBeenCalled();
			expect(result).toBeUndefined();
		});

		it("should handle workspace not found (404) error", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockRejectedValue({
					response: { status: 404 },
					isAxiosError: true,
				}),
			};

			mockVscodeProposed.window.showInformationMessage = vi
				.fn()
				.mockResolvedValue(undefined);

			const closeRemoteSpy = vi.spyOn(remote, "closeRemote");
			const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateWorkspaceAccess(
				mockRestClient,
				"/path/to/coder",
				{
					label: "test",
					username: "user",
					workspace: "workspace",
					agent: undefined,
					host: "test-host",
				},
				"user/workspace",
				"https://test.coder.com",
			);

			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"That workspace doesn't exist!",
				{
					modal: true,
					detail:
						"user/workspace cannot be found on https://test.coder.com. Maybe it was deleted...",
					useCustom: true,
				},
				"Open Workspace",
			);
			expect(closeRemoteSpy).toHaveBeenCalled();
			expect(executeCommandSpy).toHaveBeenCalledWith("coder.open");
			expect(result).toBeUndefined();
		});

		it("should handle session expired (401) error", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
				getWorkspaceByOwnerAndName: vi.fn().mockRejectedValue({
					response: { status: 401 },
					isAxiosError: true,
				}),
			};

			mockVscodeProposed.window.showInformationMessage = vi
				.fn()
				.mockResolvedValue("Log In");

			const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateWorkspaceAccess(
				mockRestClient,
				"/path/to/coder",
				{
					label: "test",
					username: "user",
					workspace: "workspace",
					agent: undefined,
					host: "test-host",
				},
				"user/workspace",
				"https://test.coder.com",
			);

			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"Your session expired...",
				{
					useCustom: true,
					modal: true,
					detail: "You must log in to access user/workspace.",
				},
				"Log In",
			);
			expect(executeCommandSpy).toHaveBeenCalledWith(
				"coder.login",
				"https://test.coder.com",
				undefined,
				"test",
			);
			expect(result).toEqual({ retry: true });
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

			// Call setup with a non-coder remote authority (must include '+' to pass validation)
			const result = await remote.setup("ssh-remote+non-coder-host");

			expect(result).toBeUndefined();
			expect(parseRemoteAuthority).toHaveBeenCalledWith(
				"ssh-remote+non-coder-host",
			);
		});

		it.skip("should show error and close remote for incompatible server version", async () => {
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

			// Mock makeCoderSdk - only getBuildInfo needs to be mocked for this test
			// since the incompatible server check happens before workspace fetching
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v0.13.0" }),
				getWorkspaceByOwnerAndName: vi.fn(),
			} as never;
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockWorkspaceRestClient);

			// Mock storage.fetchBinary
			vi.mocked(mockStorage.fetchBinary).mockResolvedValue("/path/to/coder");

			// Mock storage.writeToCoderOutputChannel to track logs
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockImplementation(
				() => {},
			);

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

		it.skip("should handle workspace not found (404) error", async () => {
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

			// Mock storage.fetchBinary
			vi.mocked(mockStorage.fetchBinary).mockResolvedValue("/path/to/coder");

			// Mock storage.writeToCoderOutputChannel to track logs
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockImplementation(
				() => {},
			);

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

		it.skip("should handle session expired (401) error", async () => {
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

			// Mock storage.fetchBinary
			vi.mocked(mockStorage.fetchBinary).mockResolvedValue("/path/to/coder");

			// Mock storage.writeToCoderOutputChannel to track logs
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockImplementation(
				() => {},
			);

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
			// This test is now covered by the setupBinaryManagement tests
			// The original test was testing implementation details of the monolithic setup method
			// After refactoring, we test the extracted method directly

			// Create remote in development mode
			remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			// Directly test the setupBinaryManagement method
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			// Mock fs.stat to simulate /tmp/coder exists
			const fs = await import("fs/promises");
			vi.mocked(fs.stat).mockResolvedValue({} as never);

			// Mock os.tmpdir to ensure we're checking the right path
			const os = await import("os");
			vi.mocked(os.tmpdir).mockReturnValue("/tmp");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const binaryPath = await (remote as any).setupBinaryManagement(
				mockWorkspaceRestClient,
				"test-label",
			);

			// Verify that fs.stat was called with the development binary path
			expect(fs.stat).toHaveBeenCalledWith("/tmp/coder");
			// Verify that fetchBinary was not called because development binary exists
			expect(mockStorage.fetchBinary).not.toHaveBeenCalled();
			// Verify the returned path
			expect(binaryPath).toBe("/tmp/coder");
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

	describe("Logger integration", () => {
		it.skip("should use Logger when set on Storage for logging messages", async () => {
			// Import the factory function for creating logger with mock
			const { createMockOutputChannelWithLogger } = await import(
				"./test-helpers"
			);
			const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();

			// Create a real Storage instance with the mock output channel
			const { Storage } = await import("./storage");
			const realStorage = new Storage(
				mockOutputChannel as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				logger,
			);

			// Spy on storage methods we need
			vi.spyOn(realStorage, "getSessionTokenPath").mockReturnValue(
				"/mock/session/path",
			);
			vi.spyOn(realStorage, "migrateSessionToken").mockResolvedValue(undefined);
			vi.spyOn(realStorage, "readCliConfig").mockResolvedValue({
				url: "https://test.coder.com",
				token: "test-token",
			});
			vi.spyOn(realStorage, "getRemoteSSHLogPath").mockResolvedValue(undefined);
			vi.spyOn(realStorage, "fetchBinary").mockResolvedValue("/path/to/coder");
			vi.spyOn(realStorage, "getNetworkInfoPath").mockReturnValue(
				"/mock/network/info",
			);
			vi.spyOn(realStorage, "getLogPath").mockReturnValue("/mock/log/path");
			vi.spyOn(realStorage, "getHeaders").mockResolvedValue({});

			// Create remote with the real storage that has logger
			remote = new Remote(
				mockVscodeProposed,
				realStorage,
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

			// Storage config already mocked above

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

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

			// Mock storage.fetchBinary
			vi.spyOn(realStorage, "fetchBinary").mockResolvedValue("/path/to/coder");

			// Mock cli.version
			const cli = await import("./cliManager");
			vi.mocked(cli.version).mockResolvedValue("v0.15.0");

			// Mock featureSetForVersion
			const { featureSetForVersion } = await import("./featureSet");
			vi.mocked(featureSetForVersion).mockReturnValue({
				vscodessh: true,
			} as never);

			// Mock user cancellation
			const showInfoMessageSpy = mockVscodeProposed.window
				.showInformationMessage as ReturnType<typeof vi.fn>;
			showInfoMessageSpy.mockResolvedValue(undefined);

			// Mock closeRemote
			vi.spyOn(remote, "closeRemote").mockResolvedValue();

			// Mock isAxiosError
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			// Execute setup which should trigger logging
			await remote.setup("coder-vscode--test-label--test-user--test-workspace");

			// Verify that messages were logged through the Logger
			const logs = logger.getLogs();
			expect(logs.length).toBeGreaterThan(0);

			// Verify specific log messages were created
			const logMessages = logs.map((log) => log.message);
			expect(logMessages).toContain(
				"Setting up remote: test-user/test-workspace",
			);
			expect(logMessages).toContain(
				"Using deployment URL: https://test.coder.com",
			);
			expect(logMessages).toContain("Using deployment label: test-label");
			expect(logMessages).toContain(
				"Got build info: v0.15.0 vscodessh feature: true",
			);

			// Verify messages were written to output channel with proper formatting
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringMatching(
					/\[.*\] \[INFO\] Setting up remote: test-user\/test-workspace/,
				),
			);
		});

		it("should maintain backward compatibility with writeToCoderOutputChannel", async () => {
			// Import the factory function for creating logger with mock
			const { createMockOutputChannelWithLogger } = await import(
				"./test-helpers"
			);
			const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();

			// Test backward compatibility method
			logger.writeToCoderOutputChannel("Test backward compatibility");

			// Verify it logs at INFO level
			const logs = logger.getLogs();
			expect(logs).toHaveLength(1);
			expect(logs[0].level).toBe("INFO");
			expect(logs[0].message).toBe("Test backward compatibility");

			// Verify output format
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringMatching(/\[.*\] \[INFO\] Test backward compatibility/),
			);
		});
	});

	describe("validateRemoteAuthority", () => {
		it("should return undefined for invalid authority format", () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Test invalid format - no '+' separator
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (remote as any).validateRemoteAuthority("invalid");
			expect(result).toBeUndefined();
		});

		it("should return undefined for non-Coder authority", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return null for non-Coder host
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValueOnce(null);

			// Test non-Coder SSH remote
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (remote as any).validateRemoteAuthority(
				"ssh-remote+regular-ssh-host",
			);
			expect(result).toBeUndefined();
		});

		it("should return parsed parts for valid Coder authority", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValueOnce({
				label: "test",
				username: "testuser",
				workspace: "testworkspace",
				agent: undefined,
				host: "coder-vscode--testuser--testworkspace",
			});

			// Test valid Coder authority
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateRemoteAuthority(
				"ssh-remote+coder-vscode--testuser--testworkspace",
			);

			expect(result).toEqual({
				parts: {
					label: "test",
					username: "testuser",
					workspace: "testworkspace",
					agent: undefined,
					host: "coder-vscode--testuser--testworkspace",
				},
				workspaceName: "testuser/testworkspace",
			});
		});

		it("should return undefined for empty string", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Test empty string
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).validateRemoteAuthority("");
			expect(result).toBeUndefined();
		});

		it("should log workspace name when valid", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock parseRemoteAuthority to return valid parts
			const { parseRemoteAuthority } = await import("./util");
			vi.mocked(parseRemoteAuthority).mockReturnValueOnce({
				label: "test",
				username: "testuser",
				workspace: "testworkspace",
				agent: undefined,
				host: "coder-vscode--testuser--testworkspace",
			});

			// Test valid Coder authority
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (remote as any).validateRemoteAuthority(
				"ssh-remote+coder-vscode--testuser--testworkspace",
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Setting up remote: testuser/testworkspace",
			);
		});
	});

	describe("setupBinaryManagement", () => {
		it("should fetch binary in production mode", async () => {
			const mockStorage = createMockStorage();
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).setupBinaryManagement(
				mockWorkspaceRestClient,
				"test-label",
			);

			expect(mockStorage.fetchBinary).toHaveBeenCalledWith(
				mockWorkspaceRestClient,
				"test-label",
			);
			expect(result).toBe("/path/to/coder");
		});

		it("should use development binary if exists in development mode", async () => {
			const mockStorage = createMockStorage();
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			// Mock fs.stat to succeed (file exists)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(fs.stat).mockResolvedValueOnce({} as any);

			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).setupBinaryManagement(
				mockWorkspaceRestClient,
				"test-label",
			);

			expect(fs.stat).toHaveBeenCalledWith("/tmp/coder");
			expect(mockStorage.fetchBinary).not.toHaveBeenCalled();
			expect(result).toBe("/tmp/coder");
		});

		it("should fetch binary in development mode if dev binary doesn't exist", async () => {
			const mockStorage = createMockStorage();
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			// Mock fs.stat to fail (file doesn't exist)
			vi.mocked(fs.stat).mockRejectedValueOnce(new Error("File not found"));

			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).setupBinaryManagement(
				mockWorkspaceRestClient,
				"test-label",
			);

			expect(fs.stat).toHaveBeenCalled();
			expect(mockStorage.fetchBinary).toHaveBeenCalledWith(
				mockWorkspaceRestClient,
				"test-label",
			);
			expect(result).toBe("/path/to/coder");
		});

		it("should pass through WorkspaceRestClient to fetchBinary", async () => {
			const mockStorage = createMockStorage();
			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "test-version" }),
			} as never;

			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (remote as any).setupBinaryManagement(
				mockWorkspaceRestClient,
				"test-label",
			);

			expect(mockStorage.fetchBinary).toHaveBeenCalledWith(
				mockWorkspaceRestClient,
				"test-label",
			);
		});
	});

	describe("ensureWorkspaceRunning", () => {
		it("should return workspace immediately if already running", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			const runningWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "running" },
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).ensureWorkspaceRunning(
				mockWorkspaceRestClient,
				runningWorkspace,
				{ label: "test-label" },
				"/path/to/binary",
			);

			expect(result).toBe(runningWorkspace);
			// Should not try to start workspace or call maybeWaitForRunning
		});

		it("should attempt to start workspace if not running and return updated workspace", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			const stoppedWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "stopped" },
			};

			const runningWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "running" },
			};

			// Mock maybeWaitForRunning to return updated workspace
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "maybeWaitForRunning").mockResolvedValue(
				runningWorkspace,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).ensureWorkspaceRunning(
				mockWorkspaceRestClient,
				stoppedWorkspace,
				{ label: "test-label" },
				"/path/to/binary",
			);

			expect(result).toBe(runningWorkspace);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).maybeWaitForRunning).toHaveBeenCalledWith(
				mockWorkspaceRestClient,
				stoppedWorkspace,
				"test-label",
				"/path/to/binary",
			);
		});

		it("should close remote and return undefined if user declines to start workspace", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			const stoppedWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "stopped" },
			};

			// Mock maybeWaitForRunning to return undefined (user declined)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "maybeWaitForRunning").mockResolvedValue(
				undefined,
			);

			// Mock closeRemote
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).ensureWorkspaceRunning(
				mockWorkspaceRestClient,
				stoppedWorkspace,
				{ label: "test-label" },
				"/path/to/binary",
			);

			expect(result).toBeUndefined();
			expect(closeRemoteSpy).toHaveBeenCalled();
		});

		it("should handle different workspace states correctly", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockWorkspaceRestClient = {
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			} as never;

			// Test with failed status
			const failedWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "failed" },
			};

			const runningWorkspace = {
				name: "test-workspace",
				owner_name: "test-user",
				latest_build: { status: "running" },
			};

			// Mock maybeWaitForRunning
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "maybeWaitForRunning").mockResolvedValue(
				runningWorkspace,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).ensureWorkspaceRunning(
				mockWorkspaceRestClient,
				failedWorkspace,
				{ label: "test-label" },
				"/path/to/binary",
			);

			expect(result).toBe(runningWorkspace);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).maybeWaitForRunning).toHaveBeenCalledWith(
				mockWorkspaceRestClient,
				failedWorkspace,
				"test-label",
				"/path/to/binary",
			);
		});
	});

	describe("updateRemoteSettings", () => {
		it("should update remote platform setting when not set", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const mockStorage = createMockStorage() as any;
			mockStorage.getUserSettingsPath = vi
				.fn()
				.mockReturnValue("/home/user/.config/Code/User/settings.json");
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock workspace configuration
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "remote.SSH.remotePlatform") {
						return {};
					}
					if (key === "remote.SSH.connectTimeout") {
						return undefined;
					}
					return undefined;
				}),
			};
			mockVscodeProposed.workspace.getConfiguration = vi
				.fn()
				.mockReturnValue(mockConfig as never);

			// Mock fs operations
			vi.mocked(fs.readFile).mockResolvedValue("{}");
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const parts = { host: "test-host" } as never;
			const agent = { operating_system: "linux" } as never;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).updateRemoteSettings(parts, agent);

			expect(result).toEqual({ platformUpdated: true, timeoutUpdated: true });
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/home/user/.config/Code/User/settings.json",
				expect.stringContaining("test-host"),
			);
		});

		it("should update connection timeout when below minimum", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const mockStorage = createMockStorage() as any;
			mockStorage.getUserSettingsPath = vi
				.fn()
				.mockReturnValue("/home/user/.config/Code/User/settings.json");
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock workspace configuration with low timeout
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "remote.SSH.remotePlatform") {
						return { "test-host": "linux" };
					}
					if (key === "remote.SSH.connectTimeout") {
						return 15;
					}
					return undefined;
				}),
			};
			mockVscodeProposed.workspace.getConfiguration = vi
				.fn()
				.mockReturnValue(mockConfig as never);

			// Mock fs operations
			vi.mocked(fs.readFile).mockResolvedValue("{}");
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const parts = { host: "test-host" } as never;
			const agent = { operating_system: "linux" } as never;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).updateRemoteSettings(parts, agent);

			expect(result).toEqual({ platformUpdated: false, timeoutUpdated: true });
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/home/user/.config/Code/User/settings.json",
				expect.stringContaining("1800"),
			);
		});

		it("should handle file write errors gracefully", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const mockStorage = createMockStorage() as any;
			mockStorage.getUserSettingsPath = vi
				.fn()
				.mockReturnValue("/home/user/.config/Code/User/settings.json");
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock workspace configuration
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "remote.SSH.remotePlatform") {
						return {};
					}
					if (key === "remote.SSH.connectTimeout") {
						return undefined;
					}
					return undefined;
				}),
			};
			mockVscodeProposed.workspace.getConfiguration = vi
				.fn()
				.mockReturnValue(mockConfig as never);

			// Mock fs operations - writeFile fails
			vi.mocked(fs.readFile).mockResolvedValue("{}");
			vi.mocked(fs.writeFile).mockRejectedValue(
				new Error("Read-only file system"),
			);

			const parts = { host: "test-host" } as never;
			const agent = { operating_system: "linux" } as never;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).updateRemoteSettings(parts, agent);

			expect(result).toEqual({ platformUpdated: false, timeoutUpdated: false });
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.stringContaining("Failed to configure settings"),
			);
		});

		it("should not update when settings are already correct", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const mockStorage = createMockStorage() as any;
			mockStorage.getUserSettingsPath = vi
				.fn()
				.mockReturnValue("/home/user/.config/Code/User/settings.json");
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock workspace configuration with correct settings
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "remote.SSH.remotePlatform") {
						return { "test-host": "linux" };
					}
					if (key === "remote.SSH.connectTimeout") {
						return 1800;
					}
					return undefined;
				}),
			};
			mockVscodeProposed.workspace.getConfiguration = vi
				.fn()
				.mockReturnValue(mockConfig as never);

			// Mock fs operations
			vi.mocked(fs.readFile).mockResolvedValue("{}");
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const parts = { host: "test-host" } as never;
			const agent = { operating_system: "linux" } as never;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).updateRemoteSettings(parts, agent);

			expect(result).toEqual({ platformUpdated: false, timeoutUpdated: false });
			expect(fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("waitForAgentConnection", () => {
		it("should wait for connecting agent to become connected", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const agent = {
				id: "agent-123",
				name: "test-agent",
				status: "connecting",
			} as never;

			const workspaceName = "test-user/test-workspace";

			// Mock workspace monitor
			const mockMonitor = {
				onChange: {
					event: vi.fn((callback) => {
						// Simulate agent becoming connected after a delay
						setTimeout(() => {
							callback({
								latest_build: {
									resources: [
										{
											agents: [
												{
													id: "agent-123",
													name: "test-agent",
													status: "connected",
												},
											],
										},
									],
								},
							});
						}, 10);
						return { dispose: vi.fn() };
					}),
				},
			} as never;

			// Mock extractAgents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([
				{
					id: "agent-123",
					name: "test-agent",
					status: "connected",
				} as never,
			]);

			// Mock withProgress to execute the task immediately
			mockVscodeProposed.window.withProgress = vi
				.fn()
				// eslint-disable-next-line @typescript-eslint/require-await
				.mockImplementation(async (_options, task) => task());

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).waitForAgentConnection(
				agent,
				workspaceName,
				mockMonitor,
			);

			expect(result).toEqual({
				id: "agent-123",
				name: "test-agent",
				status: "connected",
			});
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Waiting for test-user/test-workspace/test-agent...",
			);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Agent test-agent status is now connected",
			);
		});

		it("should return immediately if agent is already connected", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const agent = {
				id: "agent-123",
				name: "test-agent",
				status: "connected",
			} as never;

			const workspaceName = "test-user/test-workspace";
			const mockMonitor = {} as never;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).waitForAgentConnection(
				agent,
				workspaceName,
				mockMonitor,
			);

			expect(result).toBe(agent);
			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalledWith(
				expect.stringContaining("Waiting for"),
			);
		});

		it("should show error and return undefined if agent fails to connect", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const agent = {
				id: "agent-123",
				name: "test-agent",
				status: "timeout",
			} as never;

			const workspaceName = "test-user/test-workspace";
			const mockMonitor = {} as never;

			// Mock showErrorMessage
			const showErrorMessageSpy = mockVscodeProposed.window
				.showErrorMessage as ReturnType<typeof vi.fn>;
			showErrorMessageSpy.mockResolvedValue(undefined); // User cancels

			// Mock closeRemote
			vi.spyOn(remote, "closeRemote").mockResolvedValue();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).waitForAgentConnection(
				agent,
				workspaceName,
				mockMonitor,
			);

			expect(result).toBeUndefined();
			expect(showErrorMessageSpy).toHaveBeenCalledWith(
				"test-user/test-workspace/test-agent timeout",
				expect.objectContaining({
					detail: expect.stringContaining("agent failed to connect"),
				}),
			);
			expect(remote.closeRemote).toHaveBeenCalled();
		});

		it("should reload window if user chooses to retry", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const agent = {
				id: "agent-123",
				name: "test-agent",
				status: "disconnected",
			} as never;

			const workspaceName = "test-user/test-workspace";
			const mockMonitor = {} as never;

			// Mock showErrorMessage - user clicks something (not undefined)
			const showErrorMessageSpy = mockVscodeProposed.window
				.showErrorMessage as ReturnType<typeof vi.fn>;
			showErrorMessageSpy.mockResolvedValue("Retry");

			// Mock reloadWindow
			vi.spyOn(remote, "reloadWindow").mockResolvedValue();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).waitForAgentConnection(
				agent,
				workspaceName,
				mockMonitor,
			);

			expect(result).toBeUndefined();
			expect(remote.reloadWindow).toHaveBeenCalled();
		});
	});

	describe("setupWorkspaceMonitoring", () => {
		it("should create monitor and inbox with proper configuration", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspace = {
				id: "workspace-123",
				name: "test-workspace",
			} as never;

			const workspaceRestClient = {
				getBuildInfo: vi.fn(),
			} as never;

			// Mock WorkspaceMonitor constructor
			const mockMonitor = {
				onChange: {
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					event: vi.fn((callback) => ({ dispose: vi.fn() })),
				},
				dispose: vi.fn(),
			};
			const { WorkspaceMonitor } = await import("./workspaceMonitor");
			vi.mocked(WorkspaceMonitor).mockImplementation(
				() => mockMonitor as never,
			);

			// Mock createHttpAgent
			const mockHttpAgent = { agent: "mock" };
			const { createHttpAgent } = await import("./api");
			vi.mocked(createHttpAgent).mockResolvedValue(mockHttpAgent as never);

			// Mock Inbox constructor
			const mockInbox = { dispose: vi.fn() };
			const { Inbox } = await import("./inbox");
			vi.mocked(Inbox).mockImplementation(() => mockInbox as never);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).setupWorkspaceMonitoring(
				workspace,
				workspaceRestClient,
			);

			expect(WorkspaceMonitor).toHaveBeenCalledWith(
				workspace,
				workspaceRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			expect(createHttpAgent).toHaveBeenCalled();

			expect(Inbox).toHaveBeenCalledWith(
				workspace,
				mockHttpAgent,
				workspaceRestClient,
				mockStorage,
			);

			expect(result.monitor).toBe(mockMonitor);
			expect(result.inbox).toBe(mockInbox);
			expect(result.disposables).toHaveLength(3);
		});

		it("should set up workspace change event handler", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspace = {
				id: "workspace-123",
				name: "test-workspace",
			} as never;

			const workspaceRestClient = {} as never;

			// Mock WorkspaceMonitor with event handler
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let workspaceChangeCallback: any;
			const mockMonitor = {
				onChange: {
					event: vi.fn((callback) => {
						workspaceChangeCallback = callback;
						return { dispose: vi.fn() };
					}),
				},
				dispose: vi.fn(),
			};
			const { WorkspaceMonitor } = await import("./workspaceMonitor");
			vi.mocked(WorkspaceMonitor).mockImplementation(
				() => mockMonitor as never,
			);

			// Mock createHttpAgent
			const { createHttpAgent } = await import("./api");
			vi.mocked(createHttpAgent).mockResolvedValue({} as never);

			// Mock Inbox
			const { Inbox } = await import("./inbox");
			vi.mocked(Inbox).mockImplementation(
				() => ({ dispose: vi.fn() }) as never,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (remote as any).setupWorkspaceMonitoring(
				workspace,
				workspaceRestClient,
			);

			// Verify the onChange event was set up
			expect(mockMonitor.onChange.event).toHaveBeenCalled();

			// Test the callback updates commands.workspace
			const newWorkspace = { id: "new-workspace", name: "updated" };
			workspaceChangeCallback(newWorkspace);
			expect(mockCommands.workspace).toBe(newWorkspace);
		});

		it("should properly dispose all resources", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspace = {} as never;
			const workspaceRestClient = {} as never;

			// Mock disposables
			const mockMonitorDispose = vi.fn();
			const mockEventDispose = vi.fn();
			const mockInboxDispose = vi.fn();

			const mockMonitor = {
				onChange: {
					event: vi.fn(() => ({ dispose: mockEventDispose })),
				},
				dispose: mockMonitorDispose,
			};
			const { WorkspaceMonitor } = await import("./workspaceMonitor");
			vi.mocked(WorkspaceMonitor).mockImplementation(
				() => mockMonitor as never,
			);

			const { createHttpAgent } = await import("./api");
			vi.mocked(createHttpAgent).mockResolvedValue({} as never);

			const mockInbox = { dispose: mockInboxDispose };
			const { Inbox } = await import("./inbox");
			vi.mocked(Inbox).mockImplementation(() => mockInbox as never);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).setupWorkspaceMonitoring(
				workspace,
				workspaceRestClient,
			);

			// Dispose all resources
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			result.disposables.forEach((d: any) => d.dispose());

			// Verify all dispose methods were called
			expect(mockMonitorDispose).toHaveBeenCalled();
			expect(mockEventDispose).toHaveBeenCalled();
			expect(mockInboxDispose).toHaveBeenCalled();
		});
	});

	describe("configureSSHConnection", () => {
		it("should configure SSH with proper parameters", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspaceRestClient = {} as never;
			const parts = {
				label: "test-label",
				host: "test-host",
			} as never;
			const binaryPath = "/path/to/coder";
			const featureSet = {
				proxyLogDirectory: true,
				wildcardSSH: true,
			} as never;

			// Mock getLogDir
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "getLogDir").mockReturnValue("/path/to/logs");

			// Mock updateSSHConfig
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "updateSSHConfig").mockResolvedValue(undefined);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).configureSSHConnection(
				workspaceRestClient,
				parts,
				binaryPath,
				featureSet,
			);

			expect(result).toBe("/path/to/logs");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).getLogDir).toHaveBeenCalledWith(featureSet);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Updating SSH config...",
			);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).updateSSHConfig).toHaveBeenCalledWith(
				workspaceRestClient,
				"test-label",
				"test-host",
				binaryPath,
				"/path/to/logs",
				featureSet,
			);
		});

		it("should handle SSH configuration errors", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspaceRestClient = {} as never;
			const parts = {
				label: "test-label",
				host: "test-host",
			} as never;
			const binaryPath = "/path/to/coder";
			const featureSet = {} as never;

			// Mock getLogDir
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "getLogDir").mockReturnValue("");

			// Mock updateSSHConfig to throw error
			const sshError = new Error("SSH config update failed");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "updateSSHConfig").mockRejectedValue(sshError);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await expect(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(remote as any).configureSSHConnection(
					workspaceRestClient,
					parts,
					binaryPath,
					featureSet,
				),
			).rejects.toThrow("SSH config update failed");

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Failed to configure SSH: Error: SSH config update failed",
			);
		});

		it("should work without log directory when feature not supported", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const workspaceRestClient = {} as never;
			const parts = {
				label: "test-label",
				host: "test-host",
			} as never;
			const binaryPath = "/path/to/coder";
			const featureSet = {
				proxyLogDirectory: false,
			} as never;

			// Mock getLogDir to return empty string
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "getLogDir").mockReturnValue("");

			// Mock updateSSHConfig
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "updateSSHConfig").mockResolvedValue(undefined);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).configureSSHConnection(
				workspaceRestClient,
				parts,
				binaryPath,
				featureSet,
			);

			expect(result).toBe("");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).updateSSHConfig).toHaveBeenCalledWith(
				workspaceRestClient,
				"test-label",
				"test-host",
				binaryPath,
				"", // Empty log directory
				featureSet,
			);
		});
	});

	describe("setupSSHProcessMonitoring", () => {
		it("should set up SSH process monitoring and log path when pid is found", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const logDir = "/path/to/logs";
			const mockPid = 1234;
			const mockDisposable = { dispose: vi.fn() };

			// Mock findSSHProcessID
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "findSSHProcessID").mockResolvedValue(mockPid);

			// Mock showNetworkUpdates
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "showNetworkUpdates").mockReturnValue(
				mockDisposable,
			);

			// Mock fs.readdir
			const logFiles = ["other.log", "1234.log", "prefix-1234.log"];
			vi.mocked(fs.readdir).mockResolvedValue(logFiles as never);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(remote as any).setupSSHProcessMonitoring(logDir);

			// Wait for the async callback to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).findSSHProcessID).toHaveBeenCalled();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).showNetworkUpdates).toHaveBeenCalledWith(mockPid);
			expect(fs.readdir).toHaveBeenCalledWith(logDir);
			expect(mockCommands.workspaceLogPath).toBe("prefix-1234.log");
		});

		it("should handle case when pid is not found", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const logDir = "/path/to/logs";

			// Mock findSSHProcessID to return undefined
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "findSSHProcessID").mockResolvedValue(undefined);

			// Mock showNetworkUpdates - should not be called
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const showNetworkSpy = vi.spyOn(remote as any, "showNetworkUpdates");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(remote as any).setupSSHProcessMonitoring(logDir);

			// Wait for the async callback to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).findSSHProcessID).toHaveBeenCalled();
			expect(showNetworkSpy).not.toHaveBeenCalled();
			expect(fs.readdir).not.toHaveBeenCalled();
			expect(mockCommands.workspaceLogPath).toBeUndefined();
		});

		it("should handle case when logDir is not provided", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const mockPid = 1234;
			const mockDisposable = { dispose: vi.fn() };

			// Mock findSSHProcessID
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "findSSHProcessID").mockResolvedValue(mockPid);

			// Mock showNetworkUpdates
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "showNetworkUpdates").mockReturnValue(
				mockDisposable,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(remote as any).setupSSHProcessMonitoring(undefined);

			// Wait for the async callback to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).findSSHProcessID).toHaveBeenCalled();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).showNetworkUpdates).toHaveBeenCalledWith(mockPid);
			expect(fs.readdir).not.toHaveBeenCalled();
			expect(mockCommands.workspaceLogPath).toBeUndefined();
		});
	});

	describe("maybeWaitForRunning", () => {
		it("should return workspace immediately if already running", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const defaultBuild = createMockWorkspace().latest_build;
			const workspace = createMockWorkspace({
				latest_build: {
					...defaultBuild,
					status: "running",
				},
			});
			const restClient = {} as never;
			const label = "test-label";
			const binPath = "/path/to/bin";

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).maybeWaitForRunning(
				restClient,
				workspace,
				label,
				binPath,
			);

			expect(result).toBe(workspace);
		});

		it("should start workspace if stopped and user confirms", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const defaultBuild = createMockWorkspace().latest_build;
			const workspace = createMockWorkspace({
				latest_build: {
					...defaultBuild,
					status: "stopped",
				},
			});
			const restClient = {} as never;
			const label = "test-label";
			const binPath = "/path/to/bin";

			// Mock confirmStart to return true
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "confirmStart").mockResolvedValue(true);

			// Mock startWorkspaceIfStoppedOrFailed
			const updatedDefaultBuild = createMockWorkspace().latest_build;
			const updatedWorkspace = createMockWorkspace({
				latest_build: {
					...updatedDefaultBuild,
					status: "running",
				},
			});
			const { startWorkspaceIfStoppedOrFailed } = await import("./api");
			vi.mocked(startWorkspaceIfStoppedOrFailed).mockResolvedValue(
				updatedWorkspace,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).maybeWaitForRunning(
				restClient,
				workspace,
				label,
				binPath,
			);

			expect(result).toBe(updatedWorkspace);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).confirmStart).toHaveBeenCalledWith(
				"owner/workspace",
			);
			expect(startWorkspaceIfStoppedOrFailed).toHaveBeenCalled();
		});

		it("should return undefined if user declines to start workspace", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const defaultBuild = createMockWorkspace().latest_build;
			const workspace = createMockWorkspace({
				latest_build: {
					...defaultBuild,
					status: "stopped",
				},
			});
			const restClient = {} as never;
			const label = "test-label";
			const binPath = "/path/to/bin";

			// Mock confirmStart to return false
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(remote as any, "confirmStart").mockResolvedValue(false);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).maybeWaitForRunning(
				restClient,
				workspace,
				label,
				binPath,
			);

			expect(result).toBeUndefined();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((remote as any).confirmStart).toHaveBeenCalled();
		});
	});

	describe("getNetworkInfoPath", () => {
		it("should call storage.getNetworkInfoPath", () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock getNetworkInfoPath on storage
			const mockPath = "/path/to/network/info";
			vi.spyOn(mockStorage, "getNetworkInfoPath").mockReturnValue(mockPath);

			// Access private method - note: this tests the storage integration
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const networkPath = (remote as any).storage.getNetworkInfoPath();

			expect(networkPath).toBe(mockPath);
			expect(mockStorage.getNetworkInfoPath).toHaveBeenCalled();
		});
	});

	describe("reloadWindow", () => {
		it("should execute reload window command", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand");

			await remote.reloadWindow();

			expect(executeCommandSpy).toHaveBeenCalledWith(
				"workbench.action.reloadWindow",
			);
		});
	});

	describe("closeRemote", () => {
		it("should execute close remote command", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand");

			await remote.closeRemote();

			expect(executeCommandSpy).toHaveBeenCalledWith(
				"workbench.action.remote.close",
			);
		});
	});

	describe("confirmStart", () => {
		it("should show confirmation dialog and return true when user confirms", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			vi.mocked(
				mockVscodeProposed.window.showInformationMessage,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			).mockResolvedValue("Start" as any);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).confirmStart("test-workspace");

			expect(result).toBe(true);
			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"Unable to connect to the workspace test-workspace because it is not running. Start the workspace?",
				{
					useCustom: true,
					modal: true,
				},
				"Start",
			);
		});

		it("should return false when user cancels", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			vi.mocked(
				mockVscodeProposed.window.showInformationMessage,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			).mockResolvedValue(undefined as any);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).confirmStart("test-workspace");

			expect(result).toBe(false);
		});
	});

	describe("formatLogArg", () => {
		it("should return empty string when logDir is empty", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).formatLogArg("");

			expect(result).toBe("");
			expect(fs.mkdir).not.toHaveBeenCalled();
		});

		it("should create directory and return formatted argument", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const logDir = "/path/to/logs";
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (remote as any).formatLogArg(logDir);

			expect(fs.mkdir).toHaveBeenCalledWith(logDir, { recursive: true });
			expect(result).toBe(` --log-dir ${logDir}`);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				`SSH proxy diagnostics are being written to ${logDir}`,
			);
		});
	});

	describe("showNetworkUpdates", () => {
		it("should create status bar item and update with network info", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock status bar item
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				mockStatusBarItem as any,
			);

			// Mock getNetworkInfoPath
			vi.spyOn(mockStorage, "getNetworkInfoPath").mockReturnValue(
				"/network/info",
			);

			// Mock fs.readFile to return network data
			const networkData = {
				p2p: false,
				latency: 50,
				preferred_derp: "us-east",
				derp_latency: { "us-east": 20, "us-west": 40 },
				upload_bytes_sec: 1000,
				download_bytes_sec: 2000,
				using_coder_connect: false,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkData));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const disposable = (remote as any).showNetworkUpdates(1234);

			// Wait for the periodic refresh to run
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockStatusBarItem.show).toHaveBeenCalled();
			expect(mockStatusBarItem.text).toContain("us-east");
			expect(mockStatusBarItem.text).toContain("(50.00ms)");
			expect(mockStatusBarItem.tooltip).toContain("connected through a relay");

			// Test dispose
			disposable.dispose();
			expect(mockStatusBarItem.dispose).toHaveBeenCalled();
		});

		it("should handle Coder Connect mode", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock status bar item
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				mockStatusBarItem as any,
			);

			// Mock getNetworkInfoPath
			vi.spyOn(mockStorage, "getNetworkInfoPath").mockReturnValue(
				"/network/info",
			);

			// Mock fs.readFile to return Coder Connect data
			const networkData = {
				using_coder_connect: true,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkData));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(remote as any).showNetworkUpdates(1234);

			// Wait for the periodic refresh to run
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockStatusBarItem.text).toBe("$(globe) Coder Connect ");
			expect(mockStatusBarItem.tooltip).toBe(
				"You're connected using Coder Connect.",
			);
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it("should handle peer-to-peer connection", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			// Mock status bar item
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				mockStatusBarItem as any,
			);

			// Mock getNetworkInfoPath
			vi.spyOn(mockStorage, "getNetworkInfoPath").mockReturnValue(
				"/network/info",
			);

			// Mock fs.readFile to return p2p data
			const networkData = {
				p2p: true,
				latency: 10,
				preferred_derp: "direct",
				derp_latency: {},
				upload_bytes_sec: 5000,
				download_bytes_sec: 10000,
				using_coder_connect: false,
			};
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkData));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(remote as any).showNetworkUpdates(1234);

			// Wait for the periodic refresh to run
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockStatusBarItem.text).toContain("Direct");
			expect(mockStatusBarItem.text).toContain("(10.00ms)");
			expect(mockStatusBarItem.tooltip).toContain("connected peer-to-peer");
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});
	});

	describe("getLogDir", () => {
		it("should return empty string when feature not supported", () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = { proxyLogDirectory: false };

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (remote as any).getLogDir(featureSet);

			expect(result).toBe("");
		});

		it("should return configured log directory when supported", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = { proxyLogDirectory: true };
			const logDir = "/custom/log/dir";

			// Mock workspace configuration
			vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
				get: vi.fn().mockReturnValue(logDir),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any);

			// Mock expandPath to return the input value
			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockImplementation((path) => path);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (remote as any).getLogDir(featureSet);

			expect(result).toBe(logDir);
			expect(expandPath).toHaveBeenCalledWith(logDir);
		});

		it("should return empty string when config not set", async () => {
			const mockStorage = createMockStorage();
			const remote = new Remote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Production,
			);

			const featureSet = { proxyLogDirectory: true };

			// Mock workspace configuration to return undefined
			vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
				get: vi.fn().mockReturnValue(undefined),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any);

			// Mock expandPath to return empty string when passed empty string
			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockImplementation((path) => path || "");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (remote as any).getLogDir(featureSet);

			expect(result).toBe("");
			expect(expandPath).toHaveBeenCalledWith("");
		});
	});
});
