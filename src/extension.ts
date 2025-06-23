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
import { toSafeHost } from "./util";
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider";

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
	const storage = new Storage(
		output,
		ctx.globalState,
		ctx.secrets,
		ctx.globalStorageUri,
		ctx.logUri,
	);

	// Create and set Logger for structured logging
	const { Logger } = await import("./logger");
	const verbose =
		vscode.workspace.getConfiguration().get<boolean>("coder.verbose") ?? false;
	const logger = new Logger(output, { verbose });
	storage.setLogger(logger);

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

	// createTreeView, unlike registerTreeDataProvider, gives us the tree view API
	// (so we can see when it is visible) but otherwise they have the same effect.
	const myWsTree = vscode.window.createTreeView("myWorkspaces", {
		treeDataProvider: myWorkspacesProvider,
	});
	myWorkspacesProvider.setVisibility(myWsTree.visible);
	myWsTree.onDidChangeVisibility((event) => {
		myWorkspacesProvider.setVisibility(event.visible);
	});

	const allWsTree = vscode.window.createTreeView("allWorkspaces", {
		treeDataProvider: allWorkspacesProvider,
	});
	allWorkspacesProvider.setVisibility(allWsTree.visible);
	allWsTree.onDidChangeVisibility((event) => {
		allWorkspacesProvider.setVisibility(event.visible);
	});

	return { myWorkspacesProvider, allWorkspacesProvider };
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

				// We are not guaranteed that the URL we currently have is for the URL
				// this workspace belongs to, or that we even have a URL at all (the
				// queries will default to localhost) so ask for it if missing.
				// Pre-populate in case we do have the right URL so the user can just
				// hit enter and move on.
				const url = await commands.maybeAskUrl(
					params.get("url"),
					storage.getUrl(),
				);
				if (url) {
					restClient.setHost(url);
					await storage.setUrl(url);
				} else {
					throw new Error(
						"url must be provided or specified as a query parameter",
					);
				}

				// If the token is missing we will get a 401 later and the user will be
				// prompted to sign in again, so we do not need to ensure it is set now.
				// For non-token auth, we write a blank token since the `vscodessh`
				// command currently always requires a token file.  However, if there is
				// a query parameter for non-token auth go ahead and use it anyway; all
				// that really matters is the file is created.
				const token = needToken()
					? params.get("token")
					: (params.get("token") ?? "");
				if (token) {
					restClient.setSessionToken(token);
					await storage.setSessionToken(token);
				}

				// Store on disk to be used by the cli.
				await storage.configureCli(toSafeHost(url), url, token);

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

				// We are not guaranteed that the URL we currently have is for the URL
				// this workspace belongs to, or that we even have a URL at all (the
				// queries will default to localhost) so ask for it if missing.
				// Pre-populate in case we do have the right URL so the user can just
				// hit enter and move on.
				const url = await commands.maybeAskUrl(
					params.get("url"),
					storage.getUrl(),
				);
				if (url) {
					restClient.setHost(url);
					await storage.setUrl(url);
				} else {
					throw new Error(
						"url must be provided or specified as a query parameter",
					);
				}

				// If the token is missing we will get a 401 later and the user will be
				// prompted to sign in again, so we do not need to ensure it is set now.
				// For non-token auth, we write a blank token since the `vscodessh`
				// command currently always requires a token file.  However, if there is
				// a query parameter for non-token auth go ahead and use it anyway; all
				// that really matters is the file is created.
				const token = needToken()
					? params.get("token")
					: (params.get("token") ?? "");

				// Store on disk to be used by the cli.
				await storage.configureCli(toSafeHost(url), url, token);

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

export async function handleRemoteEnvironment(
	vscodeProposed: typeof vscode,
	remoteSSHExtension: vscode.Extension<unknown> | undefined,
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
	commands: Commands,
	ctx: vscode.ExtensionContext,
): Promise<boolean> {
	// Skip if no remote SSH extension or no remote authority
	if (!remoteSSHExtension || !vscodeProposed.env.remoteAuthority) {
		return true; // No remote environment to handle
	}

	const remote = new Remote(
		vscodeProposed,
		storage,
		commands,
		ctx.extensionMode,
	);

	try {
		const details = await remote.setup(vscodeProposed.env.remoteAuthority);
		if (details) {
			// Authenticate the plugin client which is used in the sidebar to display
			// workspaces belonging to this deployment.
			restClient.setHost(details.url);
			restClient.setSessionToken(details.token);
		}
		return true; // Success
	} catch (ex) {
		if (ex && typeof ex === "object" && "x509Err" in ex && "showModal" in ex) {
			const certError = ex as {
				x509Err?: string;
				message?: string;
				showModal: (title: string) => Promise<void>;
			};
			storage.writeToCoderOutputChannel(
				certError.x509Err || certError.message || "Certificate error",
			);
			await certError.showModal("Failed to open workspace");
		} else if (isAxiosError(ex)) {
			const msg = getErrorMessage(ex, "None");
			const detail = getErrorDetail(ex) || "None";
			const urlString = axios.getUri(ex.config);
			const method = ex.config?.method?.toUpperCase() || "request";
			const status = ex.response?.status || "None";
			const message = `API ${method} to '${urlString}' failed.\nStatus code: ${status}\nMessage: ${msg}\nDetail: ${detail}`;
			storage.writeToCoderOutputChannel(message);
			await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
				detail: message,
				modal: true,
				useCustom: true,
			});
		} else {
			const message = errToStr(ex, "No error message was provided");
			storage.writeToCoderOutputChannel(message);
			await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
				detail: message,
				modal: true,
				useCustom: true,
			});
		}
		// Always close remote session when we fail to open a workspace.
		await remote.closeRemote();
		return false; // Failed
	}
}

export async function checkAuthentication(
	restClient: ReturnType<typeof makeCoderSdk>,
	storage: Storage,
	myWorkspacesProvider: WorkspaceProvider,
	allWorkspacesProvider: WorkspaceProvider,
): Promise<void> {
	// See if the plugin client is authenticated.
	const baseUrl = restClient.getAxiosInstance().defaults.baseURL;
	if (baseUrl) {
		storage.writeToCoderOutputChannel(
			`Logged in to ${baseUrl}; checking credentials`,
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

				// Fetch and monitor workspaces, now that we know the client is good.
				myWorkspacesProvider.fetchAndRefresh();
				allWorkspacesProvider.fetchAndRefresh();
			} else {
				storage.writeToCoderOutputChannel(
					`No error, but got unexpected response: ${user}`,
				);
			}
		} catch (error) {
			// This should be a failure to make the request, like the header command
			// errored.
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			storage.writeToCoderOutputChannel(
				`Failed to check user authentication: ${errorMessage}`,
			);
			vscode.window.showErrorMessage(
				`Failed to check user authentication: ${errorMessage}`,
			);
		} finally {
			await vscode.commands.executeCommand("setContext", "coder.loaded", true);
		}
	} else {
		storage.writeToCoderOutputChannel("Not currently logged in");
		await vscode.commands.executeCommand("setContext", "coder.loaded", true);
	}
}

export async function handleAutologin(
	restClient: ReturnType<typeof makeCoderSdk>,
): Promise<void> {
	// Only proceed if not already authenticated
	const baseUrl = restClient.getAxiosInstance().defaults.baseURL;
	if (baseUrl) {
		return; // Already logged in
	}

	// Check if autologin is enabled
	const cfg = vscode.workspace.getConfiguration();
	if (cfg.get("coder.autologin") !== true) {
		return; // Autologin not enabled
	}

	// Get the URL from config or environment
	const defaultUrl = cfg.get("coder.defaultUrl") || process.env.CODER_URL;
	if (!defaultUrl) {
		return; // No URL available
	}

	// Execute login command
	await vscode.commands.executeCommand(
		"coder.login",
		defaultUrl,
		undefined,
		undefined,
		"true",
	);
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	// Setup remote SSH extension if available
	const { vscodeProposed, remoteSSHExtension } = setupRemoteSSHExtension();

	// Initialize infrastructure
	const output = vscode.window.createOutputChannel("Coder");
	const { storage } = await initializeInfrastructure(ctx, output);

	// Initialize REST client
	const restClient = await initializeRestClient(storage);

	// Setup tree views
	const { myWorkspacesProvider, allWorkspacesProvider } = setupTreeViews(
		restClient,
		storage,
	);

	// Create commands instance (needed for URI handler)
	const commands = new Commands(vscodeProposed, restClient, storage);

	// Register URI handler
	registerUriHandler(commands, restClient, storage);

	// Register commands
	registerCommands(commands, myWorkspacesProvider, allWorkspacesProvider);

	// Handle remote environment if applicable
	const remoteHandled = await handleRemoteEnvironment(
		vscodeProposed,
		remoteSSHExtension,
		restClient,
		storage,
		commands,
		ctx,
	);
	if (!remoteHandled) {
		return; // Exit early if remote setup failed
	}

	// Check authentication
	await checkAuthentication(
		restClient,
		storage,
		myWorkspacesProvider,
		allWorkspacesProvider,
	);

	// Handle autologin if not authenticated
	await handleAutologin(restClient);
}
