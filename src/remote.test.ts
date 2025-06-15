import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeEach, MockedFunction } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Remote } from "./remote";
import { Storage } from "./storage";

// Mock external dependencies
vi.mock("vscode", () => ({
	ExtensionMode: {
		Development: 1,
		Production: 2,
		Test: 3,
	},
	commands: {
		executeCommand: vi.fn(),
	},
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTerminal: vi.fn(),
		withProgress: vi.fn(),
		createStatusBarItem: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
		registerResourceLabelFormatter: vi.fn(),
	},
	ProgressLocation: {
		Notification: 15,
	},
	StatusBarAlignment: {
		Left: 1,
		Right: 2,
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
		dispose: vi.fn(),
	})),
	TerminalLocation: {
		Panel: 1,
	},
	ThemeIcon: vi.fn(),
}));

vi.mock("fs/promises", () => ({
	stat: vi.fn(),
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn(),
}));

vi.mock("os", async () => {
	const actual = await vi.importActual("os");
	return {
		...actual,
		tmpdir: vi.fn(() => "/tmp"),
		homedir: vi.fn(() => "/home/user"),
	};
});

vi.mock("path", async () => {
	const actual = await vi.importActual("path");
	return {
		...actual,
		join: vi.fn((...args) => args.join("/")),
		dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
	};
});

vi.mock("semver", () => ({
	parse: vi.fn(),
}));

vi.mock("./api", () => ({
	makeCoderSdk: vi.fn(),
	needToken: vi.fn(),
	waitForBuild: vi.fn(),
	startWorkspaceIfStoppedOrFailed: vi.fn(),
}));

vi.mock("./api-helper", () => ({
	extractAgents: vi.fn(),
}));

vi.mock("./cliManager", () => ({
	version: vi.fn(),
}));

vi.mock("./featureSet", () => ({
	featureSetForVersion: vi.fn(),
}));

vi.mock("./util", async () => {
	const actual = await vi.importActual("./util");
	return {
		...actual,
		parseRemoteAuthority: vi.fn(),
		findPort: vi.fn(),
		expandPath: vi.fn(),
		escapeCommandArg: vi.fn(),
		AuthorityPrefix: "coder-vscode",
	};
});

vi.mock("./sshConfig", () => ({
	SSHConfig: vi.fn().mockImplementation(() => ({
		load: vi.fn(),
		update: vi.fn(),
		getRaw: vi.fn(),
	})),
	mergeSSHConfigValues: vi.fn(),
}));

vi.mock("./headers", () => ({
	getHeaderArgs: vi.fn(() => []),
}));

vi.mock("./sshSupport", () => ({
	computeSSHProperties: vi.fn(),
	sshSupportsSetEnv: vi.fn(() => true),
}));

vi.mock("axios", () => ({
	isAxiosError: vi.fn(),
}));

vi.mock("find-process", () => ({
	default: vi.fn(),
}));

vi.mock("pretty-bytes", () => ({
	default: vi.fn((bytes) => `${bytes}B`),
}));

// Type interface for accessing private methods in tests
interface TestableRemotePrivateMethods {
	getLogDir(featureSet: import("./featureSet").FeatureSet): string | undefined;
	formatLogArg(logDir: string): string;
	updateSSHConfig(
		sshConfigData: import("./sshConfig").SSHConfig,
	): Promise<void>;
	findSSHProcessID(timeout?: number): Promise<number | undefined>;
	showNetworkUpdates(sshPid: number): import("vscode").Disposable;
	confirmStart(workspaceName: string): Promise<boolean>;
	registerLabelFormatter(
		remoteAuthority: string,
		workspaceOwner: string,
		workspaceName: string,
		workspaceAgent: string,
	): import("vscode").Disposable;
}

type TestableRemoteWithPrivates = Remote & TestableRemotePrivateMethods;

// Create a testable Remote class that exposes protected methods
class TestableRemote extends Remote {
	public validateCredentials(parts: {
		username: string;
		workspace: string;
		label: string;
	}) {
		return super.validateCredentials(parts);
	}

	public createWorkspaceClient(baseUrlRaw: string, token: string) {
		return super.createWorkspaceClient(baseUrlRaw, token);
	}

	public setupBinary(workspaceRestClient: Api, label: string) {
		return super.setupBinary(workspaceRestClient, label);
	}

	public validateServerVersion(workspaceRestClient: Api, binaryPath: string) {
		return super.validateServerVersion(workspaceRestClient, binaryPath);
	}

	public fetchWorkspace(
		workspaceRestClient: Api,
		parts: { username: string; workspace: string; label: string },
		baseUrlRaw: string,
		remoteAuthority: string,
	) {
		return super.fetchWorkspace(
			workspaceRestClient,
			parts,
			baseUrlRaw,
			remoteAuthority,
		);
	}

	public createBuildLogTerminal(writeEmitter: vscode.EventEmitter<string>) {
		return super.createBuildLogTerminal(writeEmitter);
	}

	public searchSSHLogForPID(logPath: string) {
		return super.searchSSHLogForPID(logPath);
	}

	public updateNetworkStatus(
		networkStatus: vscode.StatusBarItem,
		network: {
			using_coder_connect?: boolean;
			p2p?: boolean;
			latency?: number;
			download_bytes_sec?: number;
			upload_bytes_sec?: number;
		},
	) {
		return super.updateNetworkStatus(networkStatus, network);
	}

	public waitForAgentConnection(
		agent: { id: string; status: string; name?: string },
		monitor: {
			onChange: {
				event: MockedFunction<
					(listener: () => void) => import("vscode").Disposable
				>;
			};
		},
	) {
		return super.waitForAgentConnection(agent, monitor);
	}

	public handleWorkspaceBuildStatus(
		restClient: Api,
		workspace: Workspace,
		workspaceName: string,
		globalConfigDir: string,
		binPath: string,
		attempts: number,
		writeEmitter: vscode.EventEmitter<string> | undefined,
		terminal: vscode.Terminal | undefined,
	) {
		return super.handleWorkspaceBuildStatus(
			restClient,
			workspace,
			workspaceName,
			globalConfigDir,
			binPath,
			attempts,
			writeEmitter,
			terminal,
		);
	}

	public initWriteEmitterAndTerminal(
		writeEmitter: vscode.EventEmitter<string> | undefined,
		terminal: vscode.Terminal | undefined,
	) {
		return super.initWriteEmitterAndTerminal(writeEmitter, terminal);
	}

	public createNetworkRefreshFunction(
		networkInfoFile: string,
		updateStatus: (network: {
			using_coder_connect?: boolean;
			p2p?: boolean;
			latency?: number;
			download_bytes_sec?: number;
			upload_bytes_sec?: number;
		}) => void,
		isDisposed: () => boolean,
	) {
		return super.createNetworkRefreshFunction(
			networkInfoFile,
			updateStatus,
			isDisposed,
		);
	}

	public handleSSHProcessFound(
		disposables: vscode.Disposable[],
		logDir: string,
		pid: number | undefined,
	) {
		return super.handleSSHProcessFound(disposables, logDir, pid);
	}

	public handleExtensionChange(
		disposables: vscode.Disposable[],
		remoteAuthority: string,
		workspace: Workspace,
		agent: { name?: string },
	) {
		return super.handleExtensionChange(
			disposables,
			remoteAuthority,
			workspace,
			agent,
		);
	}

	// Expose private methods for testing
	public testGetLogDir(featureSet: {
		proxyLogDirectory?: boolean;
		vscodessh?: boolean;
		wildcardSSH?: boolean;
	}) {
		return (this as TestableRemoteWithPrivates).getLogDir(featureSet);
	}

	public testFormatLogArg(logDir: string) {
		return (this as TestableRemoteWithPrivates).formatLogArg(logDir);
	}

	public testUpdateSSHConfig(
		restClient: Api,
		label: string,
		hostName: string,
		binaryPath: string,
		logDir: string,
		featureSet: {
			proxyLogDirectory?: boolean;
			vscodessh?: boolean;
			wildcardSSH?: boolean;
		},
	) {
		return (this as TestableRemoteWithPrivates).updateSSHConfig(
			restClient,
			label,
			hostName,
			binaryPath,
			logDir,
			featureSet,
		);
	}

	public testFindSSHProcessID(timeout?: number) {
		return (this as TestableRemoteWithPrivates).findSSHProcessID(timeout);
	}

	public testShowNetworkUpdates(sshPid: number) {
		return (this as TestableRemoteWithPrivates).showNetworkUpdates(sshPid);
	}

	public testMaybeWaitForRunning(
		restClient: Api,
		workspace: Workspace,
		label: string,
		binPath: string,
	) {
		return (this as TestableRemoteWithPrivates).maybeWaitForRunning(
			restClient,
			workspace,
			label,
			binPath,
		);
	}

	public testConfirmStart(workspaceName: string) {
		return (this as TestableRemoteWithPrivates).confirmStart(workspaceName);
	}

	public testRegisterLabelFormatter(
		remoteAuthority: string,
		owner: string,
		workspace: string,
		agent?: string,
	) {
		return (this as TestableRemoteWithPrivates).registerLabelFormatter(
			remoteAuthority,
			owner,
			workspace,
			agent,
		);
	}
}

describe("Remote", () => {
	let remote: TestableRemote;
	let mockVscodeProposed: {
		window: typeof vscode.window;
		workspace: typeof vscode.workspace;
		commands: typeof vscode.commands;
	};
	let mockStorage: Storage;
	let mockCommands: Commands;
	let mockRestClient: Api;
	let mockWorkspace: Workspace;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Setup mock VSCode proposed API
		mockVscodeProposed = {
			window: {
				showInformationMessage: vi.fn(),
				showErrorMessage: vi.fn(),
				withProgress: vi.fn(),
			},
			workspace: {
				getConfiguration: vi.fn(() => ({
					get: vi.fn(),
				})),
				registerResourceLabelFormatter: vi.fn(),
			},
			commands: vscode.commands,
		};

		// Setup mock storage
		mockStorage = {
			writeToCoderOutputChannel: vi.fn(),
			migrateSessionToken: vi.fn(),
			readCliConfig: vi.fn(),
			fetchBinary: vi.fn(),
			getSessionTokenPath: vi.fn().mockReturnValue("/session/token"),
			getNetworkInfoPath: vi.fn().mockReturnValue("/network/info"),
			getUrlPath: vi.fn().mockReturnValue("/url/path"),
			getRemoteSSHLogPath: vi.fn(),
			getUserSettingsPath: vi.fn().mockReturnValue("/user/settings.json"),
		} as unknown as Storage;

		// Setup mock commands
		mockCommands = {
			workspace: undefined,
			workspaceRestClient: undefined,
		} as unknown as Commands;

		// Setup mock REST client
		mockRestClient = {
			getBuildInfo: vi.fn(),
			getWorkspaceByOwnerAndName: vi.fn(),
		} as unknown as Api;

		// Setup mock workspace
		mockWorkspace = {
			id: "workspace-1",
			name: "test-workspace",
			owner_name: "testuser",
			latest_build: {
				status: "running",
			},
		} as Workspace;

		// Create Remote instance
		remote = new TestableRemote(
			mockVscodeProposed,
			mockStorage,
			mockCommands,
			vscode.ExtensionMode.Production,
		);

		// Setup default mocks
		const { makeCoderSdk, needToken } = await import("./api");
		const { featureSetForVersion } = await import("./featureSet");
		const { version } = await import("./cliManager");
		const fs = await import("fs/promises");

		vi.mocked(needToken).mockReturnValue(true);
		vi.mocked(makeCoderSdk).mockResolvedValue(mockRestClient);
		vi.mocked(featureSetForVersion).mockReturnValue({
			vscodessh: true,
			proxyLogDirectory: true,
			wildcardSSH: true,
		});
		vi.mocked(version).mockResolvedValue("v2.15.0");
		vi.mocked(fs.stat).mockResolvedValue({} as fs.Stats);
	});

	describe("constructor", () => {
		it("should create Remote instance with correct parameters", () => {
			const newRemote = new TestableRemote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			expect(newRemote).toBeDefined();
			expect(newRemote).toBeInstanceOf(Remote);
		});
	});

	describe("validateCredentials", () => {
		const mockParts = {
			username: "testuser",
			workspace: "test-workspace",
			label: "test-deployment",
		};

		it("should return credentials when valid URL and token exist", async () => {
			mockStorage.readCliConfig.mockResolvedValue({
				url: "https://coder.example.com",
				token: "test-token",
			});

			const result = await remote.validateCredentials(mockParts);

			expect(result).toEqual({
				baseUrlRaw: "https://coder.example.com",
				token: "test-token",
			});
			expect(mockStorage.migrateSessionToken).toHaveBeenCalledWith(
				"test-deployment",
			);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Using deployment URL: https://coder.example.com",
			);
		});

		it("should prompt for login when no token exists", async () => {
			mockStorage.readCliConfig.mockResolvedValue({
				url: "https://coder.example.com",
				token: "",
			});
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				"Log In",
			);
			const _closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			const result = await remote.validateCredentials(mockParts);

			expect(result).toEqual({});
			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"You are not logged in...",
				{
					useCustom: true,
					modal: true,
					detail: "You must log in to access testuser/test-workspace.",
				},
				"Log In",
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.login",
				"https://coder.example.com",
				undefined,
				"test-deployment",
			);
		});

		it("should close remote when user declines to log in", async () => {
			mockStorage.readCliConfig.mockResolvedValue({
				url: "",
				token: "",
			});
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				undefined,
			);
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			const result = await remote.validateCredentials(mockParts);

			expect(result).toEqual({});
			expect(closeRemoteSpy).toHaveBeenCalled();
		});
	});

	describe("createWorkspaceClient", () => {
		it("should create workspace client using makeCoderSdk", async () => {
			const result = await remote.createWorkspaceClient(
				"https://coder.example.com",
				"test-token",
			);

			expect(result).toBe(mockRestClient);
			const { makeCoderSdk } = await import("./api");
			expect(makeCoderSdk).toHaveBeenCalledWith(
				"https://coder.example.com",
				"test-token",
				mockStorage,
			);
		});
	});

	describe("setupBinary", () => {
		it("should fetch binary in production mode", async () => {
			mockStorage.fetchBinary.mockResolvedValue("/path/to/coder");

			const result = await remote.setupBinary(mockRestClient, "test-label");

			expect(result).toBe("/path/to/coder");
			expect(mockStorage.fetchBinary).toHaveBeenCalledWith(
				mockRestClient,
				"test-label",
			);
		});

		it("should use development binary when available in development mode", async () => {
			const devRemote = new TestableRemote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			const fs = await import("fs/promises");
			vi.mocked(fs.stat).mockResolvedValue({} as fs.Stats); // Development binary exists

			const result = await devRemote.setupBinary(mockRestClient, "test-label");

			expect(result).toBe("/tmp/coder");
			expect(fs.stat).toHaveBeenCalledWith("/tmp/coder");
		});

		it("should fall back to fetched binary when development binary not found", async () => {
			const devRemote = new TestableRemote(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				vscode.ExtensionMode.Development,
			);

			const fs = await import("fs/promises");
			vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
			mockStorage.fetchBinary.mockResolvedValue("/path/to/fetched/coder");

			const result = await devRemote.setupBinary(mockRestClient, "test-label");

			expect(result).toBe("/path/to/fetched/coder");
			expect(mockStorage.fetchBinary).toHaveBeenCalled();
		});
	});

	describe("validateServerVersion", () => {
		it("should return feature set for compatible server version", async () => {
			mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" });

			const { featureSetForVersion } = await import("./featureSet");
			const { version } = await import("./cliManager");
			const semver = await import("semver");

			vi.mocked(version).mockResolvedValue("v2.15.0");
			vi.mocked(semver.parse).mockReturnValue({
				major: 2,
				minor: 15,
				patch: 0,
			} as semver.SemVer);

			const mockFeatureSet = { vscodessh: true, proxyLogDirectory: true };
			vi.mocked(featureSetForVersion).mockReturnValue(mockFeatureSet);

			const result = await remote.validateServerVersion(
				mockRestClient,
				"/path/to/coder",
			);

			expect(result).toBe(mockFeatureSet);
			expect(mockRestClient.getBuildInfo).toHaveBeenCalled();
		});

		it("should show error and close remote for incompatible server version", async () => {
			mockRestClient.getBuildInfo.mockResolvedValue({ version: "v0.13.0" });

			const { featureSetForVersion } = await import("./featureSet");
			const mockFeatureSet = { vscodessh: false };
			vi.mocked(featureSetForVersion).mockReturnValue(mockFeatureSet);

			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			const result = await remote.validateServerVersion(
				mockRestClient,
				"/path/to/coder",
			);

			expect(result).toBeUndefined();
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
		});

		it("should fall back to server version when CLI version fails", async () => {
			mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" });

			const { version } = await import("./cliManager");
			const semver = await import("semver");

			vi.mocked(version).mockRejectedValue(new Error("CLI error"));
			vi.mocked(semver.parse).mockReturnValue({
				major: 2,
				minor: 15,
				patch: 0,
			} as semver.SemVer);

			const result = await remote.validateServerVersion(
				mockRestClient,
				"/path/to/coder",
			);

			expect(result).toBeDefined();
			expect(semver.parse).toHaveBeenCalledWith("v2.15.0");
		});
	});

	describe("fetchWorkspace", () => {
		const mockParts = {
			username: "testuser",
			workspace: "test-workspace",
			label: "test-deployment",
		};

		it("should return workspace when found successfully", async () => {
			mockRestClient.getWorkspaceByOwnerAndName.mockResolvedValue(
				mockWorkspace,
			);

			const result = await remote.fetchWorkspace(
				mockRestClient,
				mockParts,
				"https://coder.example.com",
				"remote-authority",
			);

			expect(result).toBe(mockWorkspace);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Looking for workspace testuser/test-workspace...",
			);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Found workspace testuser/test-workspace with status running",
			);
		});

		it("should handle workspace not found (404)", async () => {
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			const axiosError = new Error("Not Found") as Error & {
				response: { status: number };
			};
			axiosError.response = { status: 404 };

			mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(axiosError);
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				"Open Workspace",
			);
			const _closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();

			const result = await remote.fetchWorkspace(
				mockRestClient,
				mockParts,
				"https://coder.example.com",
				"remote-authority",
			);

			expect(result).toBeUndefined();
			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"That workspace doesn't exist!",
				{
					modal: true,
					detail:
						"testuser/test-workspace cannot be found on https://coder.example.com. Maybe it was deleted...",
					useCustom: true,
				},
				"Open Workspace",
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("coder.open");
		});

		it("should handle session expired (401)", async () => {
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			const axiosError = new Error("Unauthorized") as Error & {
				response: { status: number };
			};
			axiosError.response = { status: 401 };

			mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(axiosError);
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				"Log In",
			);
			const _setupSpy = vi.spyOn(remote, "setup").mockResolvedValue(undefined);

			const result = await remote.fetchWorkspace(
				mockRestClient,
				mockParts,
				"https://coder.example.com",
				"remote-authority",
			);

			expect(result).toBeUndefined();
			expect(
				mockVscodeProposed.window.showInformationMessage,
			).toHaveBeenCalledWith(
				"Your session expired...",
				{
					useCustom: true,
					modal: true,
					detail: "You must log in to access testuser/test-workspace.",
				},
				"Log In",
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.login",
				"https://coder.example.com",
				undefined,
				"test-deployment",
			);
		});

		it("should rethrow non-axios errors", async () => {
			const regularError = new Error("Some other error");
			mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(regularError);

			await expect(
				remote.fetchWorkspace(
					mockRestClient,
					mockParts,
					"https://coder.example.com",
					"remote-authority",
				),
			).rejects.toThrow("Some other error");
		});
	});

	describe("closeRemote", () => {
		it("should execute workbench close remote command", async () => {
			await remote.closeRemote();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.remote.close",
			);
		});
	});

	describe("reloadWindow", () => {
		it("should execute workbench reload window command", async () => {
			await remote.reloadWindow();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.reloadWindow",
			);
		});
	});

	describe("createBuildLogTerminal", () => {
		it("should create terminal with correct configuration", () => {
			const mockWriteEmitter = new vscode.EventEmitter<string>();
			mockWriteEmitter.event = vi.fn();

			const mockTerminal = { name: "Build Log" };
			vscode.window.createTerminal.mockReturnValue(mockTerminal);

			const result = remote.createBuildLogTerminal(mockWriteEmitter);

			expect(result).toBe(mockTerminal);
			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				name: "Build Log",
				location: vscode.TerminalLocation.Panel,
				iconPath: expect.any(vscode.ThemeIcon),
				pty: expect.objectContaining({
					onDidWrite: mockWriteEmitter.event,
					close: expect.any(Function),
					open: expect.any(Function),
				}),
			});
		});
	});

	describe("searchSSHLogForPID", () => {
		it("should find SSH process ID from log file", async () => {
			const logPath = "/path/to/ssh.log";

			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue("Forwarding port 12345...");

			const { findPort } = await import("./util");
			vi.mocked(findPort).mockResolvedValue(12345);

			const find = (await import("find-process")).default;
			vi.mocked(find).mockResolvedValue([{ pid: 54321, name: "ssh" }]);

			const result = await remote.searchSSHLogForPID(logPath);

			expect(result).toBe(54321);
			expect(fs.readFile).toHaveBeenCalledWith(logPath, "utf8");
			expect(findPort).toHaveBeenCalled();
			expect(find).toHaveBeenCalledWith("port", 12345);
		});

		it("should return undefined when no port found", async () => {
			const logPath = "/path/to/ssh.log";

			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue("No port info here");

			const { findPort } = await import("./util");
			vi.mocked(findPort).mockResolvedValue(undefined);

			const result = await remote.searchSSHLogForPID(logPath);

			expect(result).toBeUndefined();
		});
	});

	describe("updateNetworkStatus", () => {
		let mockStatusBar: vscode.StatusBarItem;

		beforeEach(() => {
			mockStatusBar = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
			};
		});

		it("should update status for peer-to-peer connection", () => {
			const network = {
				using_coder_connect: false,
				p2p: true,
				latency: 15.5,
				download_bytes_sec: 1000000,
				upload_bytes_sec: 500000,
			};

			remote.updateNetworkStatus(mockStatusBar, network);

			expect(mockStatusBar.text).toBe("$(globe) Direct (15.50ms)");
			expect(mockStatusBar.tooltip).toContain("You're connected peer-to-peer");
			expect(mockStatusBar.show).toHaveBeenCalled();
		});

		it("should update status for Coder Connect", () => {
			const network = {
				using_coder_connect: true,
			};

			remote.updateNetworkStatus(mockStatusBar, network);

			expect(mockStatusBar.text).toBe("$(globe) Coder Connect ");
			expect(mockStatusBar.tooltip).toBe(
				"You're connected using Coder Connect.",
			);
			expect(mockStatusBar.show).toHaveBeenCalled();
		});
	});

	describe("waitForAgentConnection", () => {
		let mockMonitor: {
			onChange: {
				event: MockedFunction<
					(listener: () => void) => import("vscode").Disposable
				>;
			};
		};

		beforeEach(() => {
			mockMonitor = {
				onChange: {
					event: vi.fn(),
				},
			};
		});

		it("should wait for agent to connect", async () => {
			const agent = { id: "agent-1", status: "connecting" };
			const connectedAgent = { id: "agent-1", status: "connected" };

			// Mock extractAgents before test
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([connectedAgent]);

			// Mock vscode.window.withProgress
			const mockWithProgress = vi
				.fn()
				.mockImplementation(async (options, callback) => {
					return await callback();
				});
			vi.mocked(vscode.window).withProgress = mockWithProgress;

			// Mock the monitor event
			mockMonitor.onChange.event.mockImplementation(
				(
					callback: (workspace: {
						agents: Array<{ id: string; status: string; name?: string }>;
					}) => void,
				) => {
					// Simulate workspace change event
					setTimeout(() => {
						callback({ agents: [connectedAgent] });
					}, 0);
					return { dispose: vi.fn() };
				},
			);

			const result = await remote.waitForAgentConnection(agent, mockMonitor);

			expect(result).toEqual(connectedAgent);
			expect(mockWithProgress).toHaveBeenCalledWith(
				{
					title: "Waiting for the agent to connect...",
					location: vscode.ProgressLocation.Notification,
				},
				expect.any(Function),
			);
		});
	});

	describe("initWriteEmitterAndTerminal", () => {
		it("should create new emitter and terminal when not provided", () => {
			const mockTerminal = { show: vi.fn() };
			vscode.window.createTerminal.mockReturnValue(mockTerminal);

			const result = remote.initWriteEmitterAndTerminal(undefined, undefined);

			expect(result.writeEmitter).toBeDefined();
			expect(result.writeEmitter.event).toBeDefined();
			expect(result.terminal).toBe(mockTerminal);
			expect(mockTerminal.show).toHaveBeenCalledWith(true);
		});

		it("should use existing emitter and terminal when provided", () => {
			const mockEmitter = { event: vi.fn() };
			const mockTerminal = { show: vi.fn() };

			const result = remote.initWriteEmitterAndTerminal(
				mockEmitter,
				mockTerminal,
			);

			expect(result.writeEmitter).toBe(mockEmitter);
			expect(result.terminal).toBe(mockTerminal);
		});
	});

	describe("handleWorkspaceBuildStatus", () => {
		it("should handle pending workspace status", async () => {
			const workspace = {
				latest_build: { status: "pending" },
				owner_name: "test",
				name: "workspace",
			};
			const _mockEmitter = { event: vi.fn() };
			const mockTerminal = { show: vi.fn() };

			vscode.window.createTerminal.mockReturnValue(mockTerminal);

			const { waitForBuild } = await import("./api");
			const updatedWorkspace = {
				...workspace,
				latest_build: { status: "running" },
			};
			vi.mocked(waitForBuild).mockResolvedValue(updatedWorkspace);

			const result = await remote.handleWorkspaceBuildStatus(
				mockRestClient,
				workspace,
				"test/workspace",
				"/config",
				"/bin/coder",
				1,
				undefined,
				undefined,
			);

			expect(result.workspace).toBe(updatedWorkspace);
			expect(waitForBuild).toHaveBeenCalled();
		});

		it("should handle stopped workspace with user confirmation", async () => {
			const workspace = {
				latest_build: { status: "stopped" },
				owner_name: "test",
				name: "workspace",
			};

			// Mock confirmStart to return true
			const confirmStartSpy = vi
				.spyOn(remote as TestableRemoteWithPrivates, "confirmStart")
				.mockResolvedValue(true);

			const { startWorkspaceIfStoppedOrFailed } = await import("./api");
			const startedWorkspace = {
				...workspace,
				latest_build: { status: "running" },
			};
			vi.mocked(startWorkspaceIfStoppedOrFailed).mockResolvedValue(
				startedWorkspace,
			);

			const result = await remote.handleWorkspaceBuildStatus(
				mockRestClient,
				workspace,
				"test/workspace",
				"/config",
				"/bin/coder",
				1,
				undefined,
				undefined,
			);

			expect(confirmStartSpy).toHaveBeenCalledWith("test/workspace");
			expect(result.workspace).toBe(startedWorkspace);
		});

		it("should return undefined when user declines to start stopped workspace", async () => {
			const workspace = {
				latest_build: { status: "stopped" },
				owner_name: "test",
				name: "workspace",
			};

			// Mock confirmStart to return false
			const confirmStartSpy = vi
				.spyOn(remote as TestableRemoteWithPrivates, "confirmStart")
				.mockResolvedValue(false);

			const result = await remote.handleWorkspaceBuildStatus(
				mockRestClient,
				workspace,
				"test/workspace",
				"/config",
				"/bin/coder",
				1,
				undefined,
				undefined,
			);

			expect(confirmStartSpy).toHaveBeenCalledWith("test/workspace");
			expect(result.workspace).toBeUndefined();
		});
	});

	describe("createNetworkRefreshFunction", () => {
		it("should create function that reads network info and updates status", async () => {
			const networkInfoFile = "/path/to/network.json";
			const updateStatus = vi.fn();
			const isDisposed = vi.fn(() => false);

			const networkData = { p2p: true, latency: 10 };
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(networkData));

			const refreshFunction = remote.createNetworkRefreshFunction(
				networkInfoFile,
				updateStatus,
				isDisposed,
			);

			// Call the function and wait for async operations
			refreshFunction();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(fs.readFile).toHaveBeenCalledWith(networkInfoFile, "utf8");
			expect(updateStatus).toHaveBeenCalledWith(networkData);
		});

		it("should not update when disposed", async () => {
			const updateStatus = vi.fn();
			const isDisposed = vi.fn(() => true);

			const refreshFunction = remote.createNetworkRefreshFunction(
				"/path/to/network.json",
				updateStatus,
				isDisposed,
			);

			refreshFunction();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(updateStatus).not.toHaveBeenCalled();
		});
	});

	describe("handleSSHProcessFound", () => {
		it("should return early when no PID provided", async () => {
			const disposables: vscode.Disposable[] = [];

			await remote.handleSSHProcessFound(disposables, "/log/dir", undefined);

			expect(disposables).toHaveLength(0);
		});

		it("should setup network monitoring when PID exists", async () => {
			const disposables: vscode.Disposable[] = [];
			const mockDisposable = { dispose: vi.fn() };

			// Mock showNetworkUpdates
			const showNetworkUpdatesSpy = vi
				.spyOn(remote as TestableRemoteWithPrivates, "showNetworkUpdates")
				.mockReturnValue(mockDisposable);

			const fs = await import("fs/promises");
			vi.mocked(fs.readdir).mockResolvedValue([
				"123.log",
				"456-123.log",
				"other.log",
			]);

			await remote.handleSSHProcessFound(disposables, "/log/dir", 123);

			expect(showNetworkUpdatesSpy).toHaveBeenCalledWith(123);
			expect(disposables).toContain(mockDisposable);
			expect(mockCommands.workspaceLogPath).toBe("456-123.log");
		});

		it("should handle no log directory", async () => {
			const disposables: vscode.Disposable[] = [];
			const mockDisposable = { dispose: vi.fn() };

			const showNetworkUpdatesSpy = vi
				.spyOn(remote as TestableRemoteWithPrivates, "showNetworkUpdates")
				.mockReturnValue(mockDisposable);

			await remote.handleSSHProcessFound(disposables, "", 123);

			expect(showNetworkUpdatesSpy).toHaveBeenCalledWith(123);
			expect(mockCommands.workspaceLogPath).toBeUndefined();
		});
	});

	describe("handleExtensionChange", () => {
		it("should register label formatter", () => {
			const disposables: vscode.Disposable[] = [];
			const workspace = { owner_name: "test", name: "workspace" };
			const agent = { name: "main" };

			const mockDisposable = { dispose: vi.fn() };
			const registerLabelFormatterSpy = vi
				.spyOn(remote as TestableRemoteWithPrivates, "registerLabelFormatter")
				.mockReturnValue(mockDisposable);

			remote.handleExtensionChange(
				disposables,
				"remote-authority",
				workspace,
				agent,
			);

			expect(registerLabelFormatterSpy).toHaveBeenCalledWith(
				"remote-authority",
				"test",
				"workspace",
				"main",
			);
			expect(disposables).toContain(mockDisposable);
		});
	});

	describe("getLogDir", () => {
		it("should return empty string when proxyLogDirectory not supported", () => {
			const featureSet = { proxyLogDirectory: false };

			const result = remote.testGetLogDir(featureSet);

			expect(result).toBe("");
		});

		it("should return expanded path when proxyLogDirectory is supported", async () => {
			const featureSet = { proxyLogDirectory: true };

			// Mock the configuration chain properly
			const mockGet = vi.fn().mockReturnValue("/path/to/logs");
			const mockGetConfiguration = vi.fn().mockReturnValue({ get: mockGet });
			vi.mocked(vscode.workspace).getConfiguration = mockGetConfiguration;

			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockReturnValue("/expanded/path/to/logs");

			const result = remote.testGetLogDir(featureSet);

			expect(mockGetConfiguration).toHaveBeenCalled();
			expect(mockGet).toHaveBeenCalledWith("coder.proxyLogDirectory");
			expect(expandPath).toHaveBeenCalledWith("/path/to/logs");
			expect(result).toBe("/expanded/path/to/logs");
		});

		it("should handle empty proxyLogDirectory setting", async () => {
			const featureSet = { proxyLogDirectory: true };

			// Mock the configuration chain properly
			const mockGet = vi.fn().mockReturnValue(null);
			const mockGetConfiguration = vi.fn().mockReturnValue({ get: mockGet });
			vi.mocked(vscode.workspace).getConfiguration = mockGetConfiguration;

			const { expandPath } = await import("./util");
			vi.mocked(expandPath).mockReturnValue("");

			const result = remote.testGetLogDir(featureSet);

			expect(expandPath).toHaveBeenCalledWith("");
			expect(result).toBe("");
		});
	});

	describe("formatLogArg", () => {
		it("should return empty string when no log directory", async () => {
			const result = await remote.testFormatLogArg("");

			expect(result).toBe("");
		});

		it("should create directory and return formatted argument", async () => {
			const logDir = "/path/to/logs";

			const fs = await import("fs/promises");
			vi.mocked(fs.mkdir).mockResolvedValue();

			const { escapeCommandArg } = await import("./util");
			vi.mocked(escapeCommandArg).mockReturnValue("/escaped/path/to/logs");

			const result = await remote.testFormatLogArg(logDir);

			expect(fs.mkdir).toHaveBeenCalledWith(logDir, { recursive: true });
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"SSH proxy diagnostics are being written to /path/to/logs",
			);
			expect(escapeCommandArg).toHaveBeenCalledWith(logDir);
			expect(result).toBe(" --log-dir /escaped/path/to/logs");
		});
	});

	describe("findSSHProcessID", () => {
		it("should find SSH process ID successfully", async () => {
			mockStorage.getRemoteSSHLogPath = vi
				.fn()
				.mockResolvedValue("/path/to/ssh.log");
			const searchSSHLogForPIDSpy = vi
				.spyOn(remote, "searchSSHLogForPID")
				.mockResolvedValue(12345);

			const result = await remote.testFindSSHProcessID(1000);

			expect(mockStorage.getRemoteSSHLogPath).toHaveBeenCalled();
			expect(searchSSHLogForPIDSpy).toHaveBeenCalledWith("/path/to/ssh.log");
			expect(result).toBe(12345);
		});

		it("should return undefined when no log path found", async () => {
			mockStorage.getRemoteSSHLogPath = vi.fn().mockResolvedValue(null);

			const result = await remote.testFindSSHProcessID(100);

			expect(result).toBeUndefined();
		});

		it("should timeout when no process found", async () => {
			mockStorage.getRemoteSSHLogPath = vi
				.fn()
				.mockResolvedValue("/path/to/ssh.log");
			const searchSSHLogForPIDSpy = vi
				.spyOn(remote, "searchSSHLogForPID")
				.mockResolvedValue(undefined);

			const start = Date.now();
			const result = await remote.testFindSSHProcessID(100);
			const elapsed = Date.now() - start;

			expect(result).toBeUndefined();
			expect(elapsed).toBeGreaterThanOrEqual(100);
			expect(searchSSHLogForPIDSpy).toHaveBeenCalled();
		});
	});

	describe("confirmStart", () => {
		it("should return true when user confirms start", async () => {
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				"Start",
			);

			const result = await remote.testConfirmStart("test-workspace");

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
			expect(result).toBe(true);
		});

		it("should return false when user cancels", async () => {
			mockVscodeProposed.window.showInformationMessage.mockResolvedValue(
				undefined,
			);

			const result = await remote.testConfirmStart("test-workspace");

			expect(result).toBe(false);
		});
	});

	describe("showNetworkUpdates", () => {
		it("should create status bar item and periodic refresh", () => {
			const mockStatusBarItem = {
				text: "",
				tooltip: "",
				show: vi.fn(),
				dispose: vi.fn(),
			};
			vscode.window.createStatusBarItem.mockReturnValue(mockStatusBarItem);
			mockStorage.getNetworkInfoPath = vi.fn().mockReturnValue("/network/info");

			const createNetworkRefreshFunctionSpy = vi
				.spyOn(remote, "createNetworkRefreshFunction")
				.mockReturnValue(() => {});

			const result = remote.testShowNetworkUpdates(12345);

			expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
				vscode.StatusBarAlignment.Left,
				1000,
			);
			expect(createNetworkRefreshFunctionSpy).toHaveBeenCalledWith(
				"/network/info/12345.json",
				expect.any(Function),
				expect.any(Function),
			);
			expect(result).toHaveProperty("dispose");

			// Test dispose function
			result.dispose();
			expect(mockStatusBarItem.dispose).toHaveBeenCalled();
		});
	});

	describe("maybeWaitForRunning", () => {
		it("should return running workspace immediately", async () => {
			const workspace = {
				owner_name: "test",
				name: "workspace",
				latest_build: { status: "running" },
			};

			mockVscodeProposed.window.withProgress = vi
				.fn()
				.mockImplementation(async (options, callback) => {
					return await callback();
				});

			const result = await remote.testMaybeWaitForRunning(
				mockRestClient,
				workspace,
				"test-label",
				"/bin/coder",
			);

			expect(result).toBe(workspace);
			expect(mockVscodeProposed.window.withProgress).toHaveBeenCalledWith(
				{
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
					title: "Waiting for workspace build...",
				},
				expect.any(Function),
			);
		});

		it("should handle workspace build process", async () => {
			const initialWorkspace = {
				owner_name: "test",
				name: "workspace",
				latest_build: { status: "pending" },
			};
			const runningWorkspace = {
				...initialWorkspace,
				latest_build: { status: "running" },
			};

			mockStorage.getSessionTokenPath = vi
				.fn()
				.mockReturnValue("/session/token");
			const handleWorkspaceBuildStatusSpy = vi
				.spyOn(remote, "handleWorkspaceBuildStatus")
				.mockResolvedValue({
					workspace: runningWorkspace,
					writeEmitter: undefined,
					terminal: undefined,
				});

			mockVscodeProposed.window.withProgress = vi
				.fn()
				.mockImplementation(async (options, callback) => {
					return await callback();
				});

			const result = await remote.testMaybeWaitForRunning(
				mockRestClient,
				initialWorkspace,
				"test-label",
				"/bin/coder",
			);

			expect(result).toBe(runningWorkspace);
			expect(handleWorkspaceBuildStatusSpy).toHaveBeenCalled();
		});
	});

	describe("registerLabelFormatter", () => {
		it("should register label formatter with agent", () => {
			const mockDisposable = { dispose: vi.fn() };
			mockVscodeProposed.workspace.registerResourceLabelFormatter.mockReturnValue(
				mockDisposable,
			);

			const result = remote.testRegisterLabelFormatter(
				"remote-authority",
				"owner",
				"workspace",
				"agent",
			);

			expect(
				mockVscodeProposed.workspace.registerResourceLabelFormatter,
			).toHaveBeenCalledWith({
				scheme: "vscode-remote",
				authority: "remote-authority",
				formatting: {
					label: "${path}",
					separator: "/",
					tildify: true,
					workspaceSuffix: "Coder: owner∕workspace∕agent",
				},
			});
			expect(result).toBe(mockDisposable);
		});

		it("should register label formatter without agent", () => {
			const mockDisposable = { dispose: vi.fn() };
			mockVscodeProposed.workspace.registerResourceLabelFormatter.mockReturnValue(
				mockDisposable,
			);

			const result = remote.testRegisterLabelFormatter(
				"remote-authority",
				"owner",
				"workspace",
			);

			expect(
				mockVscodeProposed.workspace.registerResourceLabelFormatter,
			).toHaveBeenCalledWith({
				scheme: "vscode-remote",
				authority: "remote-authority",
				formatting: {
					label: "${path}",
					separator: "/",
					tildify: true,
					workspaceSuffix: "Coder: owner∕workspace",
				},
			});
			expect(result).toBe(mockDisposable);
		});
	});

	describe("updateSSHConfig", () => {
		let mockSSHConfig: {
			load: MockedFunction<(path: string) => Promise<void>>;
			update: MockedFunction<(data: import("./sshConfig").SSHConfig) => void>;
			getRaw: MockedFunction<() => string>;
		};

		beforeEach(async () => {
			const { SSHConfig } = await import("./sshConfig");
			mockSSHConfig = {
				load: vi.fn(),
				update: vi.fn(),
				getRaw: vi.fn().mockReturnValue("ssh config content"),
			};
			vi.mocked(SSHConfig).mockImplementation(() => mockSSHConfig);

			// Setup additional mocks
			mockStorage.getSessionTokenPath = vi
				.fn()
				.mockReturnValue("/session/token");
			mockStorage.getNetworkInfoPath = vi.fn().mockReturnValue("/network/info");
			mockStorage.getUrlPath = vi.fn().mockReturnValue("/url/path");

			// Mock vscode workspace configuration properly
			const mockGet = vi.fn().mockImplementation((key) => {
				if (key === "remote.SSH.configFile") {
					return null;
				}
				if (key === "sshConfig") {
					return [];
				}
				return null;
			});
			const mockGetConfiguration = vi.fn().mockImplementation((section) => {
				if (section === "coder") {
					return { get: vi.fn().mockReturnValue([]) };
				}
				return { get: mockGet };
			});
			vi.mocked(vscode.workspace).getConfiguration = mockGetConfiguration;
		});

		it("should update SSH config successfully", async () => {
			mockRestClient.getDeploymentSSHConfig = vi.fn().mockResolvedValue({
				ssh_config_options: { StrictHostKeyChecking: "no" },
			});

			const { mergeSSHConfigValues } = await import("./sshConfig");
			vi.mocked(mergeSSHConfigValues).mockReturnValue({
				StrictHostKeyChecking: "no",
			});

			const { getHeaderArgs } = await import("./headers");
			vi.mocked(getHeaderArgs).mockReturnValue([]);

			const { escapeCommandArg } = await import("./util");
			vi.mocked(escapeCommandArg).mockImplementation((arg) => `"${arg}"`);

			const { computeSSHProperties } = await import("./sshSupport");
			vi.mocked(computeSSHProperties).mockReturnValue({
				ProxyCommand: "mocked-proxy-command",
				UserKnownHostsFile: "/dev/null",
				StrictHostKeyChecking: "no",
			});

			// Mock formatLogArg directly instead of spying
			vi.spyOn(remote, "testFormatLogArg").mockResolvedValue(
				" --log-dir /logs",
			);

			const result = await remote.testUpdateSSHConfig(
				mockRestClient,
				"test-label",
				"test-host",
				"/bin/coder",
				"/logs",
				{ wildcardSSH: true, proxyLogDirectory: true },
			);

			expect(mockRestClient.getDeploymentSSHConfig).toHaveBeenCalled();
			expect(mockSSHConfig.load).toHaveBeenCalled();
			expect(mockSSHConfig.update).toHaveBeenCalled();
			expect(result).toBe("ssh config content");
		});

		it("should handle 404 error from deployment config", async () => {
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			const axiosError = new Error("Not Found") as Error & {
				response: { status: number };
			};
			axiosError.response = { status: 404 };

			mockRestClient.getDeploymentSSHConfig = vi
				.fn()
				.mockRejectedValue(axiosError);

			const { mergeSSHConfigValues } = await import("./sshConfig");
			vi.mocked(mergeSSHConfigValues).mockReturnValue({});

			const { computeSSHProperties } = await import("./sshSupport");
			vi.mocked(computeSSHProperties).mockReturnValue({
				ProxyCommand: "mocked-proxy-command",
				UserKnownHostsFile: "/dev/null",
				StrictHostKeyChecking: "no",
			});

			vi.spyOn(remote, "testFormatLogArg").mockResolvedValue("");

			const result = await remote.testUpdateSSHConfig(
				mockRestClient,
				"test-label",
				"test-host",
				"/bin/coder",
				"",
				{ wildcardSSH: false, proxyLogDirectory: false },
			);

			expect(result).toBe("ssh config content");
			expect(mockSSHConfig.update).toHaveBeenCalled();
		});

		it("should handle 401 error from deployment config", async () => {
			const { isAxiosError } = await import("axios");
			vi.mocked(isAxiosError).mockReturnValue(true);

			const axiosError = new Error("Unauthorized") as Error & {
				response: { status: number };
			};
			axiosError.response = { status: 401 };

			mockRestClient.getDeploymentSSHConfig = vi
				.fn()
				.mockRejectedValue(axiosError);

			await expect(
				remote.testUpdateSSHConfig(
					mockRestClient,
					"test-label",
					"test-host",
					"/bin/coder",
					"",
					{ wildcardSSH: false },
				),
			).rejects.toThrow("Unauthorized");

			expect(mockVscodeProposed.window.showErrorMessage).toHaveBeenCalledWith(
				"Your session expired...",
			);
		});

		it("should handle SSH config property mismatch", async () => {
			mockRestClient.getDeploymentSSHConfig = vi.fn().mockResolvedValue({
				ssh_config_options: {},
			});

			const { computeSSHProperties } = await import("./sshSupport");
			vi.mocked(computeSSHProperties).mockReturnValue({
				ProxyCommand: "different-command", // Mismatch!
				UserKnownHostsFile: "/dev/null",
				StrictHostKeyChecking: "no",
			});

			vi.spyOn(remote, "testFormatLogArg").mockResolvedValue("");
			const closeRemoteSpy = vi
				.spyOn(remote, "closeRemote")
				.mockResolvedValue();
			mockVscodeProposed.window.showErrorMessage.mockResolvedValue(
				"Reload Window",
			);
			const reloadWindowSpy = vi
				.spyOn(remote, "reloadWindow")
				.mockResolvedValue();

			await remote.testUpdateSSHConfig(
				mockRestClient,
				"test-label",
				"test-host",
				"/bin/coder",
				"",
				{ wildcardSSH: false },
			);

			expect(mockVscodeProposed.window.showErrorMessage).toHaveBeenCalledWith(
				"Unexpected SSH Config Option",
				expect.objectContaining({
					detail: expect.stringContaining("ProxyCommand"),
				}),
				"Reload Window",
			);
			expect(reloadWindowSpy).toHaveBeenCalled();
			expect(closeRemoteSpy).toHaveBeenCalled();
		});
	});
});
