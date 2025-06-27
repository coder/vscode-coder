"use strict";
import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as module from "module";
import * as vscode from "vscode";
import { makeCoderSdk, needToken } from "./api";
import { errToStr } from "./api-helper";
import { Commands } from "./commands";
import { getErrorDetail } from "./error";
import { Logger } from "./logger";
import { Remote } from "./remote";
import { Storage } from "./storage";
import { DefaultUIProvider } from "./uiProvider";
import { toSafeHost } from "./util";
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider";

class ExtensionDependencies {
	public readonly vscodeProposed: typeof vscode;
	public readonly remoteSSHExtension: vscode.Extension<unknown> | undefined;
	public readonly output: vscode.OutputChannel;
	public readonly storage: Storage;
	public readonly logger: Logger;
	public readonly restClient: ReturnType<typeof makeCoderSdk>;
	public readonly uiProvider: DefaultUIProvider;
	public readonly commands: Commands;
	public readonly myWorkspacesProvider: WorkspaceProvider;
	public readonly allWorkspacesProvider: WorkspaceProvider;

	private constructor(
		vscodeProposed: typeof vscode,
		remoteSSHExtension: vscode.Extension<unknown> | undefined,
		output: vscode.OutputChannel,
		storage: Storage,
		logger: Logger,
		restClient: ReturnType<typeof makeCoderSdk>,
		uiProvider: DefaultUIProvider,
		commands: Commands,
		myWorkspacesProvider: WorkspaceProvider,
		allWorkspacesProvider: WorkspaceProvider,
	) {
		this.vscodeProposed = vscodeProposed;
		this.remoteSSHExtension = remoteSSHExtension;
		this.output = output;
		this.storage = storage;
		this.logger = logger;
		this.restClient = restClient;
		this.uiProvider = uiProvider;
		this.commands = commands;
		this.myWorkspacesProvider = myWorkspacesProvider;
		this.allWorkspacesProvider = allWorkspacesProvider;
	}

	static async create(
		ctx: vscode.ExtensionContext,
	): Promise<ExtensionDependencies> {
		// Setup remote SSH extension
		const { vscodeProposed, remoteSSHExtension } = setupRemoteSSHExtension();

		// Create output channel
		const output = vscode.window.createOutputChannel("Coder");

		// Initialize infrastructure
		const { storage, logger } = await initializeInfrastructure(ctx, output);

		// Initialize REST client
		const restClient = await initializeRestClient(storage);

		// Setup tree views
		const { myWorkspacesProvider, allWorkspacesProvider } = setupTreeViews(
			restClient,
			storage,
		);

		// Create UI provider and commands
		const uiProvider = new DefaultUIProvider(vscodeProposed.window);
		const commands = new Commands(
			vscodeProposed,
			restClient,
			storage,
			uiProvider,
		);

		return new ExtensionDependencies(
			vscodeProposed,
			remoteSSHExtension,
			output,
			storage,
			logger,
			restClient,
			uiProvider,
			commands,
			myWorkspacesProvider,
			allWorkspacesProvider,
		);
	}
}

export function setupRemoteSSHExtension(): {
	vscodeProposed: typeof vscode;
	remoteSSHExtension: vscode.Extension<unknown> | undefined;
} {
	const remoteSSHExtension =
		vscode.extensions.getExtension("jeanp413.open-remote-ssh") ||
		vscode.extensions.getExtension("codeium.windsurf-remote-openssh") ||
		vscode.extensions.getExtension("anysphere.remote-ssh") ||
		vscode.extensions.getExtension("ms-vscode-remote.remote-ssh");

	let vscodeProposed: typeof vscode = vscode;

	if (!remoteSSHExtension) {
		vscode.window.showErrorMessage(
			"Remote SSH extension not found, this may not work as expected.\n" +
				// NB should we link to documentation or marketplace?
				"Please install your choice of Remote SSH extension from the VS Code Marketplace.",
		);
	} else {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vscodeProposed = (module as any)._load(
			"vscode",
			{
				filename: remoteSSHExtension.extensionPath,
			},
			false,
		);
	}

	return { vscodeProposed, remoteSSHExtension };
}

export async function initializeInfrastructure(
	ctx: vscode.ExtensionContext,
	output: vscode.OutputChannel,
): Promise<{ storage: Storage; logger: Logger }> {
	// Create Logger for structured logging
	const { Logger } = await import("./logger");
	const verbose =
		vscode.workspace.getConfiguration().get<boolean>("coder.verbose") ?? false;
	const logger = new Logger(output, { verbose });

	const storage = new Storage(
		output,
		ctx.globalState,
		ctx.secrets,
		ctx.globalStorageUri,
		ctx.logUri,
		logger,
	);

	return { storage, logger };
}

export async function initializeRestClient(
	storage: Storage,
): Promise<ReturnType<typeof makeCoderSdk>> {
	const url = storage.getUrl();
	const sessionToken = await storage.getSessionToken();
	const restClient = await makeCoderSdk(url || "", sessionToken, storage);
	return restClient;
}

function createWorkspaceTreeView(
	viewId: string,
	provider: WorkspaceProvider,
): vscode.TreeView<unknown> {
	const treeView = vscode.window.createTreeView(viewId, {
		treeDataProvider: provider,
	});

	// Set initial visibility and handle visibility changes
	provider.setVisibility(treeView.visible);
	treeView.onDidChangeVisibility((event) => {
		provider.setVisibility(event.visible);
	});

	return treeView;
}

export function setupTreeViews(
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
): {
	myWorkspacesProvider: WorkspaceProvider;
	allWorkspacesProvider: WorkspaceProvider;
} {
	const myWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.Mine,
		restClient,
		storage,
		5,
	);
	const allWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.All,
		restClient,
		storage,
	);

	// Create tree views with automatic visibility management
	createWorkspaceTreeView("myWorkspaces", myWorkspacesProvider);
	createWorkspaceTreeView("allWorkspaces", allWorkspacesProvider);

	return { myWorkspacesProvider, allWorkspacesProvider };
}

async function handleUriAuthentication(
	params: URLSearchParams,
	commands: Commands,
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
): Promise<{ url: string; token: string | null }> {
	// Get URL from params or ask user
	const url = await commands.maybeAskUrl(params.get("url"), storage.getUrl());
	if (!url) {
		throw new Error("url must be provided or specified as a query parameter");
	}

	// Update REST client and storage with URL
	restClient.setHost(url);
	await storage.setUrl(url);

	// Handle token based on authentication needs
	const token = needToken() ? params.get("token") : (params.get("token") ?? "");

	if (token) {
		restClient.setSessionToken(token);
		await storage.setSessionToken(token);
	}

	// Store on disk to be used by the CLI
	await storage.configureCli(toSafeHost(url), url, token);

	return { url, token };
}

export function registerUriHandler(
	commands: Commands,
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
): void {
	// Handle vscode:// URIs.
	vscode.window.registerUriHandler({
		handleUri: async (uri) => {
			const params = new URLSearchParams(uri.query);
			if (uri.path === "/open") {
				const owner = params.get("owner");
				const workspace = params.get("workspace");
				const agent = params.get("agent");
				const folder = params.get("folder");
				const openRecent =
					params.has("openRecent") &&
					(!params.get("openRecent") || params.get("openRecent") === "true");

				if (!owner) {
					throw new Error("owner must be specified as a query parameter");
				}
				if (!workspace) {
					throw new Error("workspace must be specified as a query parameter");
				}

				// Handle authentication and URL/token setup
				await handleUriAuthentication(params, commands, restClient, storage);

				vscode.commands.executeCommand(
					"coder.open",
					owner,
					workspace,
					agent,
					folder,
					openRecent,
				);
			} else if (uri.path === "/openDevContainer") {
				const workspaceOwner = params.get("owner");
				const workspaceName = params.get("workspace");
				const workspaceAgent = params.get("agent");
				const devContainerName = params.get("devContainerName");
				const devContainerFolder = params.get("devContainerFolder");

				if (!workspaceOwner) {
					throw new Error(
						"workspace owner must be specified as a query parameter",
					);
				}

				if (!workspaceName) {
					throw new Error(
						"workspace name must be specified as a query parameter",
					);
				}

				if (!devContainerName) {
					throw new Error(
						"dev container name must be specified as a query parameter",
					);
				}

				if (!devContainerFolder) {
					throw new Error(
						"dev container folder must be specified as a query parameter",
					);
				}

				// Handle authentication and URL/token setup
				await handleUriAuthentication(params, commands, restClient, storage);

				vscode.commands.executeCommand(
					"coder.openDevContainer",
					workspaceOwner,
					workspaceName,
					workspaceAgent,
					devContainerName,
					devContainerFolder,
				);
			} else {
				throw new Error(`Unknown path ${uri.path}`);
			}
		},
	});
}

export function registerCommands(
	commands: Commands,
	myWorkspacesProvider: WorkspaceProvider,
	allWorkspacesProvider: WorkspaceProvider,
): void {
	// Register globally available commands.  Many of these have visibility
	// controlled by contexts, see `when` in the package.json.
	vscode.commands.registerCommand("coder.login", commands.login.bind(commands));
	vscode.commands.registerCommand(
		"coder.logout",
		commands.logout.bind(commands),
	);
	vscode.commands.registerCommand("coder.open", commands.open.bind(commands));
	vscode.commands.registerCommand(
		"coder.openDevContainer",
		commands.openDevContainer.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.openFromSidebar",
		commands.openFromSidebar.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.openAppStatus",
		commands.openAppStatus.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.workspace.update",
		commands.updateWorkspace.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.createWorkspace",
		commands.createWorkspace.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.navigateToWorkspace",
		commands.navigateToWorkspace.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.navigateToWorkspaceSettings",
		commands.navigateToWorkspaceSettings.bind(commands),
	);
	vscode.commands.registerCommand("coder.refreshWorkspaces", () => {
		myWorkspacesProvider.fetchAndRefresh();
		allWorkspacesProvider.fetchAndRefresh();
	});
	vscode.commands.registerCommand(
		"coder.viewLogs",
		commands.viewLogs.bind(commands),
	);
}

class RemoteEnvironmentHandler {
	private readonly vscodeProposed: typeof vscode;
	private readonly remoteSSHExtension: vscode.Extension<unknown> | undefined;
	private readonly restClient: ReturnType<typeof makeCoderSdk>;
	private readonly storage: Storage;
	private readonly commands: Commands;
	private readonly extensionMode: vscode.ExtensionMode;

	constructor(
		deps: ExtensionDependencies,
		extensionMode: vscode.ExtensionMode,
	) {
		this.vscodeProposed = deps.vscodeProposed;
		this.remoteSSHExtension = deps.remoteSSHExtension;
		this.restClient = deps.restClient;
		this.storage = deps.storage;
		this.commands = deps.commands;
		this.extensionMode = extensionMode;
	}

	async initialize(): Promise<boolean> {
		// Skip if no remote SSH extension or no remote authority
		if (!this.remoteSSHExtension || !this.vscodeProposed.env.remoteAuthority) {
			return true; // No remote environment to handle
		}

		const remote = new Remote(
			this.vscodeProposed,
			this.storage,
			this.commands,
			this.extensionMode,
		);

		try {
			const details = await remote.setup(
				this.vscodeProposed.env.remoteAuthority,
			);
			if (details) {
				// Authenticate the plugin client
				this.restClient.setHost(details.url);
				this.restClient.setSessionToken(details.token);
			}
			return true; // Success
		} catch (ex) {
			await this.handleRemoteError(ex);
			// Always close remote session when we fail to open a workspace
			await remote.closeRemote();
			return false; // Failed
		}
	}

	private async handleRemoteError(error: unknown): Promise<void> {
		if (
			error &&
			typeof error === "object" &&
			"x509Err" in error &&
			"showModal" in error
		) {
			const certError = error as {
				x509Err?: string;
				message?: string;
				showModal: (title: string) => Promise<void>;
			};
			this.storage.writeToCoderOutputChannel(
				certError.x509Err || certError.message || "Certificate error",
			);
			await certError.showModal("Failed to open workspace");
		} else if (isAxiosError(error)) {
			const msg = getErrorMessage(error, "None");
			const detail = getErrorDetail(error) || "None";
			const urlString = axios.getUri(error.config);
			const method = error.config?.method?.toUpperCase() || "request";
			const status = error.response?.status || "None";
			const message = `API ${method} to '${urlString}' failed.\nStatus code: ${status}\nMessage: ${msg}\nDetail: ${detail}`;
			this.storage.writeToCoderOutputChannel(message);
			await this.vscodeProposed.window.showErrorMessage(
				"Failed to open workspace",
				{
					detail: message,
					modal: true,
					useCustom: true,
				},
			);
		} else {
			const message = errToStr(error, "No error message was provided");
			this.storage.writeToCoderOutputChannel(message);
			await this.vscodeProposed.window.showErrorMessage(
				"Failed to open workspace",
				{
					detail: message,
					modal: true,
					useCustom: true,
				},
			);
		}
	}
}

class ExtensionInitializer {
	private readonly deps: ExtensionDependencies;
	private readonly ctx: vscode.ExtensionContext;

	constructor(deps: ExtensionDependencies, ctx: vscode.ExtensionContext) {
		this.deps = deps;
		this.ctx = ctx;
	}

	async initialize(): Promise<void> {
		// Register URI handler and commands
		this.registerHandlers();

		// Handle remote environment if applicable
		const remoteHandler = new RemoteEnvironmentHandler(
			this.deps,
			this.ctx.extensionMode,
		);
		const remoteHandled = await remoteHandler.initialize();
		if (!remoteHandled) {
			return; // Exit early if remote setup failed
		}

		// Initialize authentication
		await initializeAuthentication(
			this.deps.restClient,
			this.deps.storage,
			this.deps.myWorkspacesProvider,
			this.deps.allWorkspacesProvider,
		);
	}

	private registerHandlers(): void {
		// Register URI handler
		registerUriHandler(
			this.deps.commands,
			this.deps.restClient,
			this.deps.storage,
		);

		// Register commands
		registerCommands(
			this.deps.commands,
			this.deps.myWorkspacesProvider,
			this.deps.allWorkspacesProvider,
		);
	}
}

export async function initializeAuthentication(
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
	myWorkspacesProvider: WorkspaceProvider,
	allWorkspacesProvider: WorkspaceProvider,
): Promise<void> {
	const baseUrl = restClient.getAxiosInstance().defaults.baseURL;

	// Handle autologin first if not already authenticated
	if (!baseUrl) {
		const cfg = vscode.workspace.getConfiguration();
		if (cfg.get("coder.autologin") === true) {
			const defaultUrl = cfg.get("coder.defaultUrl") || process.env.CODER_URL;
			if (defaultUrl) {
				storage.writeToCoderOutputChannel(
					`Attempting autologin to ${defaultUrl}`,
				);
				await vscode.commands.executeCommand(
					"coder.login",
					defaultUrl,
					undefined,
					undefined,
					"true",
				);
				// Re-check baseUrl after login attempt
				const newBaseUrl = restClient.getAxiosInstance().defaults.baseURL;
				if (!newBaseUrl) {
					storage.writeToCoderOutputChannel(
						"Autologin failed, not authenticated",
					);
					await vscode.commands.executeCommand(
						"setContext",
						"coder.loaded",
						true,
					);
					return;
				}
			} else {
				storage.writeToCoderOutputChannel("Not currently logged in");
				await vscode.commands.executeCommand(
					"setContext",
					"coder.loaded",
					true,
				);
				return;
			}
		} else {
			storage.writeToCoderOutputChannel("Not currently logged in");
			await vscode.commands.executeCommand("setContext", "coder.loaded", true);
			return;
		}
	}

	// Check authentication status
	storage.writeToCoderOutputChannel(
		`Logged in to ${restClient.getAxiosInstance().defaults.baseURL}; checking credentials`,
	);

	try {
		const user = await restClient.getAuthenticatedUser();
		if (user && user.roles) {
			storage.writeToCoderOutputChannel("Credentials are valid");
			await vscode.commands.executeCommand(
				"setContext",
				"coder.authenticated",
				true,
			);

			if (user.roles.find((role) => role.name === "owner")) {
				await vscode.commands.executeCommand(
					"setContext",
					"coder.isOwner",
					true,
				);
			}

			// Fetch and monitor workspaces
			myWorkspacesProvider.fetchAndRefresh();
			allWorkspacesProvider.fetchAndRefresh();
		} else {
			storage.writeToCoderOutputChannel(
				`No error, but got unexpected response: ${user}`,
			);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		storage.writeToCoderOutputChannel(
			`Failed to check user authentication: ${errorMessage}`,
		);
		vscode.window.showErrorMessage(
			`Failed to check user authentication: ${errorMessage}`,
		);
	} finally {
		await vscode.commands.executeCommand("setContext", "coder.loaded", true);
	}
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	// Create all dependencies
	const deps = await ExtensionDependencies.create(ctx);

	// Initialize the extension
	const initializer = new ExtensionInitializer(deps, ctx);
	await initializer.initialize();
}
