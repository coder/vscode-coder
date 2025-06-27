import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import * as vscodeActual from "vscode";
import * as extension from "./extension";
import {
	createMockExtensionContext,
	createMockRemoteSSHExtension,
	createMockWorkspaceProvider,
	createMockRemote,
	createMockStorage,
	createMockCommands,
	createMockOutputChannel,
	createMockRestClient,
	createMockAxiosInstance,
	createMockConfiguration,
	createMockTreeView,
	createMockUri,
} from "./test-helpers";

// Setup all mocks
function setupMocks() {
	// Mock axios
	vi.mock("axios", () => ({
		default: {
			create: vi.fn(() => createMockAxiosInstance()),
			getUri: vi.fn(() => "https://test.coder.com/api/v2/user"),
		},
		isAxiosError: vi.fn(),
	}));

	// Mock module._load for remote SSH extension tests
	vi.mock("module", async () => {
		const actual = await vi.importActual<typeof import("module")>("module");
		return {
			...actual,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			_load: vi.fn((request: string, parent: any, isMain: boolean) => {
				if (
					request === "vscode" &&
					parent?.filename?.includes("/path/to/extension")
				) {
					return { test: "proposed", isMocked: true };
				}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				return (actual as any)._load(request, parent, isMain);
			}),
		};
	});

	// Mock all local modules
	vi.mock("./api");
	vi.mock("./api-helper", () => ({
		errToStr: vi.fn(
			(error, defaultMessage) => error?.message || defaultMessage,
		),
	}));
	vi.mock("./commands", () => ({ Commands: vi.fn() }));
	vi.mock("./error", () => ({
		CertificateError: class extends Error {
			x509Err?: string;
			showModal = vi.fn();
			constructor(message: string, x509Err?: string) {
				super(message);
				this.x509Err = x509Err;
				this.name = "CertificateError";
			}
		},
		getErrorDetail: vi.fn(() => "Some error detail"),
	}));
	vi.mock("./remote", () => ({ Remote: vi.fn() }));
	vi.mock("./storage", () => ({ Storage: vi.fn() }));
	vi.mock("./util");
	vi.mock("./logger", () => ({
		Logger: vi.fn().mockImplementation(() => ({
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		})),
	}));
	vi.mock("./workspacesProvider", () => ({
		WorkspaceProvider: vi.fn(() => ({
			setVisibility: vi.fn(),
			refresh: vi.fn(),
			fetchAndRefresh: vi.fn(),
		})),
		WorkspaceQuery: { Mine: "mine", All: "all" },
	}));
	vi.mock("./workspaceMonitor", () => ({ WorkspaceMonitor: vi.fn() }));
	vi.mock("coder/site/src/api/errors", () => ({
		getErrorMessage: vi.fn(
			(error, defaultMessage) => error?.message || defaultMessage,
		),
	}));
	vi.mock("coder/site/src/api/api", async () => {
		const helpers = await import("./test-helpers");
		return {
			Api: class MockApi {
				setHost = vi.fn();
				setSessionToken = vi.fn();
				getAxiosInstance = vi.fn(() => helpers.createMockAxiosInstance());
			},
		};
	});

	// Mock vscode module with test helpers
	vi.mock("vscode", async () => {
		const helpers = await import("./test-helpers");
		return helpers.createMockVSCode();
	});
}

setupMocks();

beforeEach(() => {
	// Clear all mocks before each test
	vi.clearAllMocks();
});

// Test helper functions
const setupVSCodeMocks = async () => {
	const vscode = await import("vscode");
	return vscode;
};

const createAuthTestContext = () => {
	const mockStorage = createMockStorage({ writeToCoderOutputChannel: vi.fn() });
	const mockMyWorkspacesProvider = createMockWorkspaceProvider({
		fetchAndRefresh: vi.fn(),
	});
	const mockAllWorkspacesProvider = createMockWorkspaceProvider({
		fetchAndRefresh: vi.fn(),
	});
	return {
		mockStorage,
		mockMyWorkspacesProvider,
		mockAllWorkspacesProvider,
	};
};

describe("extension", () => {
	describe("setupRemoteSSHExtension", () => {
		it.each([
			["ms-vscode-remote.remote-ssh", "ms-vscode-remote.remote-ssh", false],
		])("should handle %s", async (_, extensionId, shouldShowError) => {
			const vscode = await setupVSCodeMocks();
			const mockExtension = extensionId
				? createMockRemoteSSHExtension({ extensionPath: "/path/to/extension" })
				: undefined;

			vi.mocked(vscode.extensions.getExtension).mockImplementation((id) => {
				return id === extensionId ? (mockExtension as never) : undefined;
			});

			const result = extension.setupRemoteSSHExtension();

			if (shouldShowError) {
				expect(vscodeActual.window.showErrorMessage).toHaveBeenCalledWith(
					expect.stringContaining("Remote SSH extension not found"),
				);
				expect(result.remoteSSHExtension).toBeUndefined();
			} else {
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
				expect(result.vscodeProposed).toMatchObject({
					test: "proposed",
					isMocked: true,
				});
				expect(result.remoteSSHExtension).toBe(mockExtension);
			}
		});
	});

	describe("initializeInfrastructure", () => {
		it("should create storage and logger with verbose setting from config", async () => {
			const vscode = await setupVSCodeMocks();
			const Storage = (await import("./storage")).Storage;
			const Logger = (await import("./logger")).Logger;

			// Mock verbose setting
			const mockConfig = createMockConfiguration({ "coder.verbose": true });
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			const mockOutputChannel = createMockOutputChannel();
			const mockContext = createMockExtensionContext({
				globalStorageUri: { fsPath: "/mock/global/storage" } as vscode.Uri,
				logUri: { fsPath: "/mock/log/path" } as vscode.Uri,
			});

			// Track Storage and Logger creation
			let storageInstance: unknown;
			let loggerInstance: unknown;
			vi.mocked(Storage).mockImplementation((...args: unknown[]) => {
				storageInstance = { args, setLogger: vi.fn() };
				return storageInstance as never;
			});
			vi.mocked(Logger).mockImplementation((...args: unknown[]) => {
				loggerInstance = { args };
				return loggerInstance as never;
			});

			const result = await extension.initializeInfrastructure(
				mockContext as never,
				mockOutputChannel as never,
			);

			// Verify Logger was created with verbose setting
			expect(Logger).toHaveBeenCalledWith(mockOutputChannel, { verbose: true });

			// Verify Storage was created with correct args including Logger
			expect(Storage).toHaveBeenCalledWith(
				mockOutputChannel,
				mockContext.globalState,
				mockContext.secrets,
				mockContext.globalStorageUri,
				mockContext.logUri,
				loggerInstance,
			);

			// Verify return value
			expect(result).toEqual({
				storage: storageInstance,
				logger: loggerInstance,
			});
		});
	});

	describe("initializeRestClient", () => {
		it("should create REST client with URL and session token from storage", async () => {
			const { makeCoderSdk } = await import("./api");

			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				getSessionToken: vi.fn().mockResolvedValue("test-token-123"),
			});

			const mockRestClient = createMockRestClient({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});

			vi.mocked(makeCoderSdk).mockResolvedValue(mockRestClient as never);

			const result = await extension.initializeRestClient(mockStorage as never);

			expect(mockStorage.getUrl).toHaveBeenCalled();
			expect(mockStorage.getSessionToken).toHaveBeenCalled();
			expect(makeCoderSdk).toHaveBeenCalledWith(
				"https://test.coder.com",
				"test-token-123",
				mockStorage,
			);
			expect(result).toBe(mockRestClient);
		});
	});

	describe("setupTreeViews", () => {
		it("should create workspace providers and tree views with visibility handlers", async () => {
			const vscode = await import("vscode");
			const { WorkspaceProvider, WorkspaceQuery } = await import(
				"./workspacesProvider"
			);

			const mockRestClient = createMockRestClient();
			const mockStorage = createMockStorage();
			const providers = {
				my: createMockWorkspaceProvider({
					setVisibility: vi.fn(),
					fetchAndRefresh: vi.fn(),
				}),
				all: createMockWorkspaceProvider({
					setVisibility: vi.fn(),
					fetchAndRefresh: vi.fn(),
				}),
			};
			const trees = {
				my: { visible: true, onDidChangeVisibility: vi.fn() },
				all: { visible: false, onDidChangeVisibility: vi.fn() },
			};

			vi.mocked(WorkspaceProvider).mockImplementation((query) =>
				query === WorkspaceQuery.Mine
					? (providers.my as never)
					: (providers.all as never),
			);
			vi.mocked(vscode.window.createTreeView).mockImplementation((viewId) => {
				if (viewId === "myWorkspaces") {
					return createMockTreeView({
						visible: trees.my.visible,
						onDidChangeVisibility: trees.my.onDidChangeVisibility,
					});
				} else {
					return createMockTreeView({
						visible: trees.all.visible,
						onDidChangeVisibility: trees.all.onDidChangeVisibility,
					});
				}
			});

			const result = extension.setupTreeViews(
				mockRestClient as never,
				mockStorage as never,
			);

			// Verify providers and tree views
			expect(WorkspaceProvider).toHaveBeenCalledTimes(2);
			expect(WorkspaceProvider).toHaveBeenCalledWith(
				WorkspaceQuery.Mine,
				mockRestClient,
				mockStorage,
				5,
			);
			expect(WorkspaceProvider).toHaveBeenCalledWith(
				WorkspaceQuery.All,
				mockRestClient,
				mockStorage,
			);
			expect(vscode.window.createTreeView).toHaveBeenCalledTimes(2);

			// Verify visibility
			expect(providers.my.setVisibility).toHaveBeenCalledWith(true);
			expect(providers.all.setVisibility).toHaveBeenCalledWith(false);

			// Test handlers
			vi.mocked(trees.my.onDidChangeVisibility).mock.calls[0][0]({
				visible: false,
			});
			expect(providers.my.setVisibility).toHaveBeenCalledWith(false);

			expect(result).toEqual({
				myWorkspacesProvider: providers.my,
				allWorkspacesProvider: providers.all,
			});
		});
	});

	describe("registerUriHandler", () => {
		let registeredHandler: vscodeActual.UriHandler;

		const setupUriHandler = async () => {
			const { needToken } = await import("./api");
			const { toSafeHost } = await import("./util");
			const vscode = await setupVSCodeMocks();

			vi.mocked(vscode.window.registerUriHandler).mockImplementation(
				(handler: vscodeActual.UriHandler) => {
					registeredHandler = handler;
					return { dispose: vi.fn() };
				},
			);

			return { needToken, toSafeHost };
		};

		// Test data for URI handler tests
		const uriHandlerTestCases = [
			{
				name: "/open path with all parameters",
				path: "/open",
				query:
					"owner=testuser&workspace=myws&agent=main&folder=/home/coder&openRecent=true&url=https://test.coder.com&token=test-token",
				mockUrl: "https://test.coder.com",
				oldUrl: "https://old.coder.com",
				hasToken: true,
				expectedCommand: [
					"coder.open",
					"testuser",
					"myws",
					"main",
					"/home/coder",
					true,
				],
			},
			{
				name: "/openDevContainer path",
				path: "/openDevContainer",
				query:
					"owner=devuser&workspace=devws&agent=main&devContainerName=nodejs&devContainerFolder=/workspace&url=https://dev.coder.com",
				mockUrl: "https://dev.coder.com",
				oldUrl: "",
				hasToken: false,
				expectedCommand: [
					"coder.openDevContainer",
					"devuser",
					"devws",
					"main",
					"nodejs",
					"/workspace",
				],
			},
		];

		it.each(uriHandlerTestCases)(
			"should handle $name",
			async ({ path, query, mockUrl, oldUrl, hasToken, expectedCommand }) => {
				const vscode = await import("vscode");
				const { needToken, toSafeHost } = await setupUriHandler();

				const mockCommands = createMockCommands({
					maybeAskUrl: vi.fn().mockResolvedValue(mockUrl),
				});
				const mockRestClient = createMockRestClient();
				const mockStorage = createMockStorage({
					getUrl: vi.fn().mockReturnValue(oldUrl),
				});

				vi.mocked(needToken).mockReturnValue(hasToken);
				vi.mocked(toSafeHost).mockReturnValue(
					mockUrl.replace(/https:\/\/|\.coder\.com/g, "").replace(/\./g, "-"),
				);

				extension.registerUriHandler(
					mockCommands as never,
					mockRestClient as never,
					mockStorage as never,
				);
				await registeredHandler.handleUri(createMockUri(`${path}?${query}`));

				expect(mockCommands.maybeAskUrl).toHaveBeenCalledWith(mockUrl, oldUrl);
				expect(mockRestClient.setHost).toHaveBeenCalledWith(mockUrl);
				expect(mockStorage.setUrl).toHaveBeenCalledWith(mockUrl);

				if (hasToken) {
					expect(mockRestClient.setSessionToken).toHaveBeenCalledWith(
						"test-token",
					);
					expect(mockStorage.setSessionToken).toHaveBeenCalledWith(
						"test-token",
					);
				}

				expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
					...expectedCommand,
				);
			},
		);

		it("should throw error for unknown path", async () => {
			await setupUriHandler();
			const mocks = {
				commands: createMockCommands(),
				restClient: createMockRestClient(),
				storage: createMockStorage(),
			};

			extension.registerUriHandler(
				mocks.commands as never,
				mocks.restClient as never,
				mocks.storage as never,
			);
			await expect(
				registeredHandler.handleUri(createMockUri("/unknown?")),
			).rejects.toThrow("Unknown path /unknown");
		});

		it.each([
			{
				path: "/open",
				query: "workspace=myws",
				error: "owner must be specified as a query parameter",
			},
			{
				path: "/open",
				query: "owner=testuser",
				error: "workspace must be specified as a query parameter",
			},
		])("should throw error when $error", async ({ path, query, error }) => {
			await setupUriHandler();
			const mocks = {
				commands: createMockCommands(),
				restClient: createMockRestClient(),
				storage: createMockStorage(),
			};

			extension.registerUriHandler(
				mocks.commands as never,
				mocks.restClient as never,
				mocks.storage as never,
			);
			await expect(
				registeredHandler.handleUri(createMockUri(`${path}?${query}`)),
			).rejects.toThrow(error);
		});
	});

	describe("registerCommands", () => {
		it("should register all commands with correct handlers", async () => {
			const vscode = await import("vscode");
			const mockCommands = createMockCommands();
			const providers = {
				my: createMockWorkspaceProvider({ fetchAndRefresh: vi.fn() }),
				all: createMockWorkspaceProvider({ fetchAndRefresh: vi.fn() }),
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const registeredCommands: Record<string, any> = {};
			vi.mocked(vscode.commands.registerCommand).mockImplementation(
				(command, callback) => {
					registeredCommands[command] = callback;
					return { dispose: vi.fn() };
				},
			);

			extension.registerCommands(
				mockCommands as never,
				providers.my as never,
				providers.all as never,
			);

			expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(12);

			// Test sample command bindings
			registeredCommands["coder.login"]();
			expect(mockCommands.login).toHaveBeenCalled();

			registeredCommands["coder.refreshWorkspaces"]();
			expect(providers.my.fetchAndRefresh).toHaveBeenCalled();
			expect(providers.all.fetchAndRefresh).toHaveBeenCalled();
		});
	});

	describe("handleRemoteEnvironment", () => {
		it("should handle remote environment when remoteSSHExtension and remoteAuthority exist", async () => {
			const vscode = await import("vscode");
			const { Remote } = await import("./remote");

			const mockVscodeProposed = {
				env: { remoteAuthority: "test-remote-authority" },
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockCommands = {};

			const mockContext = createMockExtensionContext({
				extensionMode: 1, // Normal mode
			});

			const mockRemote = createMockRemote({
				setup: vi.fn().mockResolvedValue({
					url: "https://test.coder.com",
					token: "test-token-123",
				}),
				closeRemote: vi.fn(),
			});

			vi.mocked(Remote).mockImplementation(() => mockRemote as never);

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(Remote).toHaveBeenCalledWith(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				mockContext.extensionMode,
			);
			expect(mockRemote.setup).toHaveBeenCalledWith("test-remote-authority");
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://test.coder.com",
			);
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith(
				"test-token-123",
			);
			expect(result).toBe(true); // Success
		});
	});

	describe("checkAuthentication", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it.each([
			[
				"valid member authentication",
				{
					baseURL: "https://test.coder.com",
					user: { username: "test-user", roles: [{ name: "member" }] },
				},
				{ authenticated: true, isOwner: false, workspacesRefreshed: true },
			],
		])("%s", async (_, config, expected) => {
			const {
				mockStorage,
				mockMyWorkspacesProvider,
				mockAllWorkspacesProvider,
			} = createAuthTestContext();

			const mockRestClient = {
				getAxiosInstance: vi
					.fn()
					.mockReturnValue({ defaults: { baseURL: config.baseURL } }),
				getAuthenticatedUser: config.user
					? vi.fn().mockResolvedValue(config.user)
					: vi.fn(),
			};

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			if (expected.authenticated) {
				expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
					"setContext",
					"coder.authenticated",
					true,
				);
				if (expected.isOwner) {
					expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
						"setContext",
						"coder.isOwner",
						true,
					);
				}
			} else if ("skipUserCheck" in expected && expected.skipUserCheck) {
				expect(mockRestClient.getAuthenticatedUser).not.toHaveBeenCalled();
			}

			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);

			if (expected.workspacesRefreshed) {
				expect(mockMyWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
				expect(mockAllWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
			} else {
				expect(mockMyWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
				expect(
					mockAllWorkspacesProvider.fetchAndRefresh,
				).not.toHaveBeenCalled();
			}
		});
	});

	describe("handleAutologin", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it.each([
			[
				"autologin enabled with defaultUrl",
				{
					autologin: true,
					defaultUrl: "https://auto.coder.com",
					baseURL: "",
					envUrl: undefined,
				},
				{ shouldLogin: true, expectedUrl: "https://auto.coder.com" },
			],
		])("should handle %s", async (_, config, expected) => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: config.baseURL },
				}),
			};

			const mockConfig = createMockConfiguration({
				"coder.autologin": config.autologin,
				"coder.defaultUrl": config.defaultUrl,
			});
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue(
				mockConfig,
			);

			// Handle environment variable
			const originalEnv = process.env.CODER_URL;
			if (config.envUrl !== undefined) {
				process.env.CODER_URL = config.envUrl;
			} else {
				delete process.env.CODER_URL;
			}

			await extension.handleAutologin(mockRestClient as never);

			if (expected.shouldLogin) {
				expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
					"coder.login",
					"expectedUrl" in expected ? expected.expectedUrl : undefined,
					undefined,
					undefined,
					"true",
				);
			} else {
				expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
					"coder.login",
					expect.anything(),
					expect.anything(),
					expect.anything(),
					expect.anything(),
				);
			}

			// Restore environment
			if (originalEnv !== undefined) {
				process.env.CODER_URL = originalEnv;
			} else {
				delete process.env.CODER_URL;
			}
		});
	});
});
