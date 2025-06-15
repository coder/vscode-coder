import { AxiosError } from "axios";
import { Api } from "coder/site/src/api/api";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import * as apiModule from "./api";
import { Commands } from "./commands";
import { CertificateError } from "./error";
import {
	activate,
	handleRemoteAuthority,
	handleRemoteSetupError,
	handleUnexpectedAuthResponse,
} from "./extension";
import { Remote } from "./remote";
import { Storage } from "./storage";
import * as utilModule from "./util";
import { WorkspaceProvider } from "./workspacesProvider";

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createOutputChannel: vi.fn(),
		createTreeView: vi.fn(),
		registerUriHandler: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(),
		executeCommand: vi.fn(),
	},
	extensions: {
		getExtension: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
	env: {
		remoteAuthority: undefined,
	},
	ExtensionMode: {
		Development: 1,
		Test: 2,
		Production: 3,
	},
}));

// Mock dependencies
vi.mock("./storage", () => ({
	Storage: vi.fn(),
}));

vi.mock("./commands", () => ({
	Commands: vi.fn(),
}));

vi.mock("./workspacesProvider", () => ({
	WorkspaceProvider: vi.fn(),
	WorkspaceQuery: {
		Mine: "owner:me",
		All: "",
	},
}));

vi.mock("./remote", () => ({
	Remote: vi.fn(),
}));

vi.mock("./api", () => ({
	makeCoderSdk: vi.fn(),
	needToken: vi.fn(),
}));

vi.mock("./util", () => ({
	toSafeHost: vi.fn(),
}));

vi.mock("axios", async () => {
	const actual = await vi.importActual("axios");
	return {
		...actual,
		isAxiosError: vi.fn(),
		getUri: vi.fn(),
	};
});

// Mock module loading for proposed API
vi.mock("module", () => {
	const originalModule = vi.importActual("module");
	return {
		...originalModule,
		_load: vi.fn(),
	};
});

// Mock type definitions
interface MockOutputChannel {
	appendLine: ReturnType<typeof vi.fn>;
	show: ReturnType<typeof vi.fn>;
}

interface MockStorage {
	getUrl: ReturnType<typeof vi.fn>;
	getSessionToken: ReturnType<typeof vi.fn>;
	setUrl: ReturnType<typeof vi.fn>;
	setSessionToken: ReturnType<typeof vi.fn>;
	configureCli: ReturnType<typeof vi.fn>;
	writeToCoderOutputChannel: ReturnType<typeof vi.fn>;
}

interface MockCommands {
	login: ReturnType<typeof vi.fn>;
	logout: ReturnType<typeof vi.fn>;
	open: ReturnType<typeof vi.fn>;
	openDevContainer: ReturnType<typeof vi.fn>;
	openFromSidebar: ReturnType<typeof vi.fn>;
	openAppStatus: ReturnType<typeof vi.fn>;
	updateWorkspace: ReturnType<typeof vi.fn>;
	createWorkspace: ReturnType<typeof vi.fn>;
	navigateToWorkspace: ReturnType<typeof vi.fn>;
	navigateToWorkspaceSettings: ReturnType<typeof vi.fn>;
	viewLogs: ReturnType<typeof vi.fn>;
	maybeAskUrl: ReturnType<typeof vi.fn>;
}

interface MockRestClient {
	setHost: ReturnType<typeof vi.fn>;
	setSessionToken: ReturnType<typeof vi.fn>;
	getAxiosInstance: ReturnType<typeof vi.fn>;
	getAuthenticatedUser: ReturnType<typeof vi.fn>;
}

interface MockTreeView {
	visible: boolean;
	onDidChangeVisibility: ReturnType<typeof vi.fn>;
}

interface MockWorkspaceProvider {
	setVisibility: ReturnType<typeof vi.fn>;
	fetchAndRefresh: ReturnType<typeof vi.fn>;
}

interface MockRemoteSSHExtension {
	extensionPath: string;
}

interface MockRemote {
	setup: ReturnType<typeof vi.fn>;
	closeRemote: ReturnType<typeof vi.fn>;
}

describe("Extension", () => {
	let mockContext: vscode.ExtensionContext;
	let mockOutputChannel: MockOutputChannel;
	let mockStorage: MockStorage;
	let mockCommands: MockCommands;
	let mockRestClient: MockRestClient;
	let mockTreeView: MockTreeView;
	let mockWorkspaceProvider: MockWorkspaceProvider;
	let mockRemoteSSHExtension: MockRemoteSSHExtension;

	beforeEach(async () => {
		vi.clearAllMocks();

		mockOutputChannel = {
			appendLine: vi.fn(),
			show: vi.fn(),
		};

		mockStorage = {
			getUrl: vi.fn(),
			getSessionToken: vi.fn(),
			setUrl: vi.fn(),
			setSessionToken: vi.fn(),
			configureCli: vi.fn(),
			writeToCoderOutputChannel: vi.fn(),
		};

		mockCommands = {
			login: vi.fn(),
			logout: vi.fn(),
			open: vi.fn(),
			openDevContainer: vi.fn(),
			openFromSidebar: vi.fn(),
			openAppStatus: vi.fn(),
			updateWorkspace: vi.fn(),
			createWorkspace: vi.fn(),
			navigateToWorkspace: vi.fn(),
			navigateToWorkspaceSettings: vi.fn(),
			viewLogs: vi.fn(),
			maybeAskUrl: vi.fn(),
		};

		mockRestClient = {
			setHost: vi.fn(),
			setSessionToken: vi.fn(),
			getAxiosInstance: vi.fn(() => ({
				defaults: { baseURL: "https://coder.example.com" },
			})),
			getAuthenticatedUser: vi.fn().mockResolvedValue({
				id: "user-1",
				username: "testuser",
				roles: [{ name: "member" }],
			}),
		};

		mockTreeView = {
			visible: true,
			onDidChangeVisibility: vi.fn(),
		};

		mockWorkspaceProvider = {
			setVisibility: vi.fn(),
			fetchAndRefresh: vi.fn(),
		};

		mockRemoteSSHExtension = {
			extensionPath: "/path/to/remote-ssh",
		};

		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
			globalStorageUri: { fsPath: "/global/storage" },
			logUri: { fsPath: "/logs" },
			extensionMode: vscode.ExtensionMode.Production,
		} as vscode.ExtensionContext;

		// Setup default mocks
		vi.mocked(vscode.window.createOutputChannel).mockReturnValue(
			mockOutputChannel,
		);
		vi.mocked(vscode.window.createTreeView).mockReturnValue(mockTreeView);
		vi.mocked(vscode.extensions.getExtension).mockReturnValue(
			mockRemoteSSHExtension,
		);
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn(() => false),
		} as vscode.WorkspaceConfiguration);

		vi.mocked(Storage).mockImplementation(() => mockStorage as Storage);
		vi.mocked(Commands).mockImplementation(() => mockCommands as Commands);
		vi.mocked(WorkspaceProvider).mockImplementation(
			() => mockWorkspaceProvider as WorkspaceProvider,
		);
		vi.mocked(Remote).mockImplementation(() => ({}) as Remote);

		vi.mocked(apiModule.makeCoderSdk).mockResolvedValue(mockRestClient as Api);
		vi.mocked(apiModule.needToken).mockReturnValue(true);
		vi.mocked(utilModule.toSafeHost).mockReturnValue("coder.example.com");

		// Mock module._load for proposed API
		const moduleModule = await import("module");
		vi.mocked(moduleModule._load).mockReturnValue(vscode);
	});

	describe("activate", () => {
		it("should throw error when Remote SSH extension is not found", async () => {
			vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);

			await expect(activate(mockContext)).rejects.toThrow(
				"Remote SSH extension not found",
			);
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Remote SSH extension not found, cannot activate Coder extension",
			);
		});

		it("should successfully activate with ms-vscode-remote.remote-ssh extension", async () => {
			const msRemoteSSH = { extensionPath: "/path/to/ms-remote-ssh" };
			vi.mocked(vscode.extensions.getExtension)
				.mockReturnValueOnce(undefined) // jeanp413.open-remote-ssh
				.mockReturnValueOnce(undefined) // codeium.windsurf-remote-openssh
				.mockReturnValueOnce(undefined) // anysphere.remote-ssh
				.mockReturnValueOnce(msRemoteSSH); // ms-vscode-remote.remote-ssh

			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");

			await activate(mockContext);

			expect(Storage).toHaveBeenCalledWith(
				mockOutputChannel,
				mockContext.globalState,
				mockContext.secrets,
				mockContext.globalStorageUri,
				mockContext.logUri,
			);
			expect(apiModule.makeCoderSdk).toHaveBeenCalledWith(
				"https://coder.example.com",
				"test-token",
				mockStorage,
			);
		});

		it("should create and configure tree views for workspaces", async () => {
			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");

			await activate(mockContext);

			expect(vscode.window.createTreeView).toHaveBeenCalledWith(
				"myWorkspaces",
				{
					treeDataProvider: mockWorkspaceProvider,
				},
			);
			expect(vscode.window.createTreeView).toHaveBeenCalledWith(
				"allWorkspaces",
				{
					treeDataProvider: mockWorkspaceProvider,
				},
			);
			expect(mockWorkspaceProvider.setVisibility).toHaveBeenCalledWith(true);
		});

		it("should register all extension commands", async () => {
			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");

			await activate(mockContext);

			const expectedCommands = [
				"coder.login",
				"coder.logout",
				"coder.open",
				"coder.openDevContainer",
				"coder.openFromSidebar",
				"coder.openAppStatus",
				"coder.workspace.update",
				"coder.createWorkspace",
				"coder.navigateToWorkspace",
				"coder.navigateToWorkspaceSettings",
				"coder.refreshWorkspaces",
				"coder.viewLogs",
			];

			expectedCommands.forEach((command) => {
				expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
					command,
					expect.any(Function),
				);
			});
		});

		it("should register URI handler for vscode:// protocol", async () => {
			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");

			await activate(mockContext);

			expect(vscode.window.registerUriHandler).toHaveBeenCalledWith({
				handleUri: expect.any(Function),
			});
		});

		it("should set authenticated context when user credentials are valid", async () => {
			const mockUser = {
				id: "user-1",
				username: "testuser",
				roles: [{ name: "member" }],
			};

			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");
			mockRestClient.getAuthenticatedUser.mockResolvedValue(mockUser);

			await activate(mockContext);

			// Wait for async authentication check
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				true,
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);
		});

		it("should set owner context for users with owner role", async () => {
			const mockUser = {
				id: "user-1",
				username: "testuser",
				roles: [{ name: "owner" }],
			};

			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");
			mockRestClient.getAuthenticatedUser.mockResolvedValue(mockUser);

			await activate(mockContext);

			// Wait for async authentication check
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.isOwner",
				true,
			);
		});

		it("should handle authentication failure gracefully", async () => {
			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("invalid-token");
			mockRestClient.getAuthenticatedUser.mockRejectedValue(
				new Error("401 Unauthorized"),
			);

			await activate(mockContext);

			// Wait for async authentication check
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to check user authentication: 401 Unauthorized",
			);
		});

		it("should handle autologin when enabled and not logged in", async () => {
			mockStorage.getUrl.mockReturnValue(undefined); // Not logged in
			mockStorage.getSessionToken.mockResolvedValue(undefined);

			// Mock restClient to have no baseURL (not logged in)
			mockRestClient.getAxiosInstance.mockReturnValue({
				defaults: { baseURL: undefined },
			});

			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return "https://auto.coder.example.com";
					}
					return undefined;
				}),
			};
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				mockConfig as vscode.WorkspaceConfiguration,
			);

			await activate(mockContext);

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.login",
				"https://auto.coder.example.com",
				undefined,
				undefined,
				"true",
			);
		});

		it("should not trigger autologin when no default URL is configured", async () => {
			mockStorage.getUrl.mockReturnValue(undefined);
			mockStorage.getSessionToken.mockResolvedValue(undefined);

			// Mock restClient to have no baseURL (not logged in)
			mockRestClient.getAxiosInstance.mockReturnValue({
				defaults: { baseURL: undefined },
			});

			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return undefined;
					}
					return undefined;
				}),
			};
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				mockConfig as vscode.WorkspaceConfiguration,
			);

			await activate(mockContext);

			expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
				"coder.login",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				"true",
			);
		});
	});

	describe("URI handler", () => {
		let uriHandler: (uri: vscode.Uri) => Promise<void>;

		beforeEach(async () => {
			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");
			mockCommands.maybeAskUrl.mockResolvedValue("https://coder.example.com");

			await activate(mockContext);

			// Get the URI handler from the registerUriHandler call
			const registerCall = vi.mocked(vscode.window.registerUriHandler).mock
				.calls[0];
			uriHandler = registerCall[0].handleUri;
		});

		it("should handle /open URI with required parameters", async () => {
			const mockUri = {
				path: "/open",
				query:
					"owner=testuser&workspace=testworkspace&agent=main&folder=/workspace&openRecent=true&url=https://test.coder.com&token=test-token",
			};

			const _params = new URLSearchParams(mockUri.query);
			mockCommands.maybeAskUrl.mockResolvedValue("https://test.coder.com");

			await uriHandler(mockUri);

			expect(mockCommands.maybeAskUrl).toHaveBeenCalledWith(
				"https://test.coder.com",
				"https://coder.example.com",
			);
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://test.coder.com",
			);
			expect(mockStorage.setUrl).toHaveBeenCalledWith("https://test.coder.com");
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(mockStorage.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.open",
				"testuser",
				"testworkspace",
				"main",
				"/workspace",
				true,
			);
		});

		it("should throw error when owner parameter is missing", async () => {
			const mockUri = {
				path: "/open",
				query: "workspace=testworkspace",
			};

			await expect(uriHandler(mockUri)).rejects.toThrow(
				"owner must be specified as a query parameter",
			);
		});

		it("should throw error when workspace parameter is missing", async () => {
			const mockUri = {
				path: "/open",
				query: "owner=testuser",
			};

			await expect(uriHandler(mockUri)).rejects.toThrow(
				"workspace must be specified as a query parameter",
			);
		});

		it("should handle /openDevContainer URI with required parameters", async () => {
			const mockUri = {
				path: "/openDevContainer",
				query:
					"owner=testuser&workspace=testworkspace&agent=main&devContainerName=mycontainer&devContainerFolder=/container&url=https://test.coder.com",
			};

			mockCommands.maybeAskUrl.mockResolvedValue("https://test.coder.com");

			await uriHandler(mockUri);

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.openDevContainer",
				"testuser",
				"testworkspace",
				"main",
				"mycontainer",
				"/container",
			);
		});

		it("should throw error for unknown URI path", async () => {
			const mockUri = {
				path: "/unknown",
				query: "",
			};

			await expect(uriHandler(mockUri)).rejects.toThrow(
				"Unknown path /unknown",
			);
		});

		it("should throw error when URL is not provided and user cancels", async () => {
			const mockUri = {
				path: "/open",
				query: "owner=testuser&workspace=testworkspace",
			};

			mockCommands.maybeAskUrl.mockResolvedValue(undefined); // User cancelled

			await expect(uriHandler(mockUri)).rejects.toThrow(
				"url must be provided or specified as a query parameter",
			);
		});
	});

	describe("Helper Functions", () => {
		describe("handleRemoteAuthority", () => {
			let mockRemote: MockRemote;

			beforeEach(() => {
				mockRemote = {
					setup: vi.fn(),
					closeRemote: vi.fn(),
				};
				vi.mocked(Remote).mockImplementation(() => mockRemote);
			});

			it("should setup remote and authenticate client when details are returned", async () => {
				const mockDetails = {
					url: "https://remote.coder.example.com",
					token: "remote-token",
					dispose: vi.fn(),
				};
				mockRemote.setup.mockResolvedValue(mockDetails);

				const mockVscodeWithAuthority = {
					...vscode,
					env: { remoteAuthority: "ssh-remote+coder-host" },
				};

				await handleRemoteAuthority(
					mockVscodeWithAuthority as typeof vscode,
					mockStorage,
					mockCommands,
					vscode.ExtensionMode.Production,
					mockRestClient,
				);

				expect(Remote).toHaveBeenCalledWith(
					mockVscodeWithAuthority,
					mockStorage,
					mockCommands,
					vscode.ExtensionMode.Production,
				);
				expect(mockRemote.setup).toHaveBeenCalledWith("ssh-remote+coder-host");
				expect(mockRestClient.setHost).toHaveBeenCalledWith(
					"https://remote.coder.example.com",
				);
				expect(mockRestClient.setSessionToken).toHaveBeenCalledWith(
					"remote-token",
				);
			});

			it("should not authenticate client when no details are returned", async () => {
				mockRemote.setup.mockResolvedValue(undefined);

				const mockVscodeWithAuthority = {
					...vscode,
					env: { remoteAuthority: "ssh-remote+coder-host" },
				};

				await handleRemoteAuthority(
					mockVscodeWithAuthority as typeof vscode,
					mockStorage,
					mockCommands,
					vscode.ExtensionMode.Production,
					mockRestClient,
				);

				expect(mockRemote.setup).toHaveBeenCalledWith("ssh-remote+coder-host");
				expect(mockRestClient.setHost).not.toHaveBeenCalled();
				expect(mockRestClient.setSessionToken).not.toHaveBeenCalled();
			});

			it("should handle setup errors by calling handleRemoteSetupError", async () => {
				const setupError = new Error("Setup failed");
				mockRemote.setup.mockRejectedValue(setupError);

				const mockVscodeWithAuthority = {
					...vscode,
					env: { remoteAuthority: "ssh-remote+coder-host" },
				};

				await handleRemoteAuthority(
					mockVscodeWithAuthority as typeof vscode,
					mockStorage,
					mockCommands,
					vscode.ExtensionMode.Production,
					mockRestClient,
				);

				expect(mockRemote.closeRemote).toHaveBeenCalled();
			});
		});

		describe("handleRemoteSetupError", () => {
			let mockRemote: MockRemote;

			beforeEach(() => {
				mockRemote = {
					closeRemote: vi.fn(),
				};
			});

			it("should handle CertificateError", async () => {
				const certError = new Error("Certificate error") as CertificateError;
				certError.x509Err = "x509: certificate signed by unknown authority";
				certError.showModal = vi.fn();
				Object.setPrototypeOf(certError, CertificateError.prototype);

				await handleRemoteSetupError(
					certError,
					vscode as typeof vscode,
					mockStorage,
					mockRemote,
				);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					"x509: certificate signed by unknown authority",
				);
				expect(certError.showModal).toHaveBeenCalledWith(
					"Failed to open workspace",
				);
				expect(mockRemote.closeRemote).toHaveBeenCalled();
			});

			it("should handle AxiosError", async () => {
				const axiosError = {
					isAxiosError: true,
					config: {
						method: "GET",
						url: "https://api.coder.example.com/workspaces",
					},
					response: {
						status: 401,
					},
				} as AxiosError;

				// Mock the extension's imports directly - it imports { isAxiosError } from "axios"
				const axiosModule = await import("axios");
				const isAxiosErrorSpy = vi
					.spyOn(axiosModule, "isAxiosError")
					.mockReturnValue(true);
				const getUriSpy = vi
					.spyOn(axiosModule.default, "getUri")
					.mockReturnValue("https://api.coder.example.com/workspaces");

				// Mock getErrorMessage and getErrorDetail
				const errorModule = await import("./error");
				const getErrorDetailSpy = vi
					.spyOn(errorModule, "getErrorDetail")
					.mockReturnValue("Unauthorized access");

				// Import and mock getErrorMessage from the API module
				const coderApiErrors = await import("coder/site/src/api/errors");
				const getErrorMessageSpy = vi
					.spyOn(coderApiErrors, "getErrorMessage")
					.mockReturnValue("Unauthorized");

				await handleRemoteSetupError(
					axiosError,
					vscode as typeof vscode,
					mockStorage,
					mockRemote,
				);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					expect.stringContaining(
						"API GET to 'https://api.coder.example.com/workspaces' failed",
					),
				);
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					"Failed to open workspace",
					expect.objectContaining({
						modal: true,
						useCustom: true,
					}),
				);
				expect(mockRemote.closeRemote).toHaveBeenCalled();

				// Restore mocks
				isAxiosErrorSpy.mockRestore();
				getUriSpy.mockRestore();
				getErrorDetailSpy.mockRestore();
				getErrorMessageSpy.mockRestore();
			});

			it("should handle generic errors", async () => {
				const genericError = new Error("Generic setup error");

				// Ensure isAxiosError returns false for generic errors
				const axiosModule = await import("axios");
				const isAxiosErrorSpy = vi
					.spyOn(axiosModule, "isAxiosError")
					.mockReturnValue(false);

				await handleRemoteSetupError(
					genericError,
					vscode as typeof vscode,
					mockStorage,
					mockRemote,
				);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					"Generic setup error",
				);
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					"Failed to open workspace",
					expect.objectContaining({
						detail: "Generic setup error",
						modal: true,
						useCustom: true,
					}),
				);
				expect(mockRemote.closeRemote).toHaveBeenCalled();

				// Restore mock
				isAxiosErrorSpy.mockRestore();
			});
		});

		describe("handleUnexpectedAuthResponse", () => {
			it("should log unexpected authentication response", () => {
				const unexpectedUser = { id: "user-1", username: "test", roles: null };

				handleUnexpectedAuthResponse(unexpectedUser, mockStorage);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					`No error, but got unexpected response: ${unexpectedUser}`,
				);
			});

			it("should handle null user response", () => {
				handleUnexpectedAuthResponse(null, mockStorage);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					"No error, but got unexpected response: null",
				);
			});

			it("should handle undefined user response", () => {
				handleUnexpectedAuthResponse(undefined, mockStorage);

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					"No error, but got unexpected response: undefined",
				);
			});
		});
	});

	describe("activate with remote authority", () => {
		it("should handle remote authority when present", async () => {
			const mockVscodeWithAuthority = {
				...vscode,
				env: { remoteAuthority: "ssh-remote+coder-host" },
			};

			const mockRemote = {
				setup: vi.fn().mockResolvedValue({
					url: "https://remote.coder.example.com",
					token: "remote-token",
					dispose: vi.fn(),
				}),
				closeRemote: vi.fn(),
			};

			vi.mocked(Remote).mockImplementation(() => mockRemote);

			// Mock module._load to return our mock vscode with remote authority
			const moduleModule = await import("module");
			vi.mocked(moduleModule._load).mockReturnValue(mockVscodeWithAuthority);

			mockStorage.getUrl.mockReturnValue("https://coder.example.com");
			mockStorage.getSessionToken.mockResolvedValue("test-token");

			await activate(mockContext);

			expect(mockRemote.setup).toHaveBeenCalledWith("ssh-remote+coder-host");
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://remote.coder.example.com",
			);
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith(
				"remote-token",
			);
		});
	});
});
