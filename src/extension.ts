"use strict";
import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as module from "module";
import * as vscode from "vscode";
import { makeCoderSdk, needToken } from "./api";
import { errToStr } from "./api-helper";
import { Commands } from "./commands";
import { CertificateError, getErrorDetail } from "./error";
import { Remote } from "./remote";
import { Storage } from "./storage";
import { toSafeHost } from "./util";
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider";

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
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

	const output = vscode.window.createOutputChannel("Coder", { log: true });
	const storage = new Storage(
		output,
		ctx.globalState,
		ctx.secrets,
		ctx.globalStorageUri,
		ctx.logUri,
	);

	// This client tracks the current login and will be used through the life of
	// the plugin to poll workspaces for the current login, as well as being used
	// in commands that operate on the current login.
	const url = storage.getUrl();
	const restClient = makeCoderSdk(
		url || "",
		await storage.getSessionToken(),
		storage,
	);

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
				const localWorkspaceFolder = params.get("localWorkspaceFolder");
				const localConfigFile = params.get("localConfigFile");

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

				if (localConfigFile && !localWorkspaceFolder) {
					throw new Error(
						"local workspace folder must be specified as a query parameter if local config file is provided",
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
					localWorkspaceFolder,
					localConfigFile,
				);
			} else {
				throw new Error(`Unknown path ${uri.path}`);
			}
		},
	});

	// Register globally available commands.  Many of these have visibility
	// controlled by contexts, see `when` in the package.json.
	const commands = new Commands(vscodeProposed, restClient, storage);
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
	vscode.commands.registerCommand(
		"coder.searchWorkspaces",
		commands.searchWorkspaces.bind(commands),
	);
	vscode.commands.registerCommand(
		"coder.setWorkspaceSearchFilter",
		(searchTerm: string) => {
			allWorkspacesProvider.setSearchFilter(searchTerm);
		},
	);
	vscode.commands.registerCommand("coder.getWorkspaceSearchFilter", () => {
		return allWorkspacesProvider.getSearchFilter();
	});
	vscode.commands.registerCommand("coder.clearWorkspaceSearch", () => {
		allWorkspacesProvider.clearSearchFilter();
	});

	// Since the "onResolveRemoteAuthority:ssh-remote" activation event exists
	// in package.json we're able to perform actions before the authority is
	// resolved by the remote SSH extension.
	//
	// In addition, if we don't have a remote SSH extension, we skip this
	// activation event. This may allow the user to install the extension
	// after the Coder extension is installed, instead of throwing a fatal error
	// (this would require the user to uninstall the Coder extension and
	// reinstall after installing the remote SSH extension, which is annoying)
	if (remoteSSHExtension && vscodeProposed.env.remoteAuthority) {
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
		} catch (ex) {
			if (ex instanceof CertificateError) {
				storage.output.warn(ex.x509Err || ex.message);
				await ex.showModal("Failed to open workspace");
			} else if (isAxiosError(ex)) {
				const msg = getErrorMessage(ex, "None");
				const detail = getErrorDetail(ex) || "None";
				const urlString = axios.getUri(ex.config);
				const method = ex.config?.method?.toUpperCase() || "request";
				const status = ex.response?.status || "None";
				const message = `API ${method} to '${urlString}' failed.\nStatus code: ${status}\nMessage: ${msg}\nDetail: ${detail}`;
				storage.output.warn(message);
				await vscodeProposed.window.showErrorMessage(
					"Failed to open workspace",
					{
						detail: message,
						modal: true,
						useCustom: true,
					},
				);
			} else {
				const message = errToStr(ex, "No error message was provided");
				storage.output.warn(message);
				await vscodeProposed.window.showErrorMessage(
					"Failed to open workspace",
					{
						detail: message,
						modal: true,
						useCustom: true,
					},
				);
			}
			// Always close remote session when we fail to open a workspace.
			await remote.closeRemote();
			return;
		}
	}

	// See if the plugin client is authenticated.
	const baseUrl = restClient.getAxiosInstance().defaults.baseURL;
	if (baseUrl) {
		storage.output.info(`Logged in to ${baseUrl}; checking credentials`);
		restClient
			.getAuthenticatedUser()
			.then(async (user) => {
				if (user && user.roles) {
					storage.output.info("Credentials are valid");
					vscode.commands.executeCommand(
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
					storage.output.warn("No error, but got unexpected response", user);
				}
			})
			.catch((error) => {
				// This should be a failure to make the request, like the header command
				// errored.
				storage.output.warn("Failed to check user authentication", error);
				vscode.window.showErrorMessage(
					`Failed to check user authentication: ${error.message}`,
				);
			})
			.finally(() => {
				vscode.commands.executeCommand("setContext", "coder.loaded", true);
			});
	} else {
		storage.output.info("Not currently logged in");
		vscode.commands.executeCommand("setContext", "coder.loaded", true);

		// Handle autologin, if not already logged in.
		const cfg = vscode.workspace.getConfiguration();
		if (cfg.get("coder.autologin") === true) {
			const defaultUrl = cfg.get("coder.defaultUrl") || process.env.CODER_URL;
			if (defaultUrl) {
				vscode.commands.executeCommand(
					"coder.login",
					defaultUrl,
					undefined,
					undefined,
					"true",
				);
			}
		}
	}
}
