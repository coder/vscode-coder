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
			},
			workspace: {
				getConfiguration: vi.fn().mockReturnValue({
					get: vi.fn(),
				}),
			},
		} as unknown as typeof vscode;

		mockStorage = {
			getSessionTokenPath: vi.fn().mockReturnValue("/mock/session/path"),
			writeToCoderOutputChannel: vi.fn(),
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
});
