"use strict";
import * as module from "module";
import * as vscode from "vscode";
import { makeCoderSdk, needToken } from "./api";
import { Commands } from "./commands";
import { ExtensionDependencies } from "./extension/dependencies";
import { ExtensionInitializer } from "./extension/initializer";
import { Logger } from "./logger";
import { Storage } from "./storage";
import { toSafeHost } from "./util";
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider";

export function setupRemoteSSHExtension(): {
	vscodeProposed: typeof vscode;
	remoteSSHExtension: vscode.Extension<unknown> | undefined;
} {
	// The Remote SSH extension's proposed APIs are used to override the SSH host
	// name in VS Code itself. It's visually unappealing having a lengthy name!
	//
	// This is janky, but that's alright since it provides such minimal
	// functionality to the extension.
	//
	// Cursor and VSCode are covered by ms remote, and the only other is windsurf for now
	// Means that vscodium is not supported by this for now
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
