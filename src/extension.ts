"use strict";
import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as module from "module";
import * as vscode from "vscode";
import { errToStr } from "./api/api-helper";
import { CoderApi } from "./api/coderApi";
import { needToken } from "./api/utils";
import { Commands } from "./commands";
import { CliManager } from "./core/cliManager";
import { MementoManager } from "./core/mementoManager";
import { PathResolver } from "./core/pathResolver";
import { SecretsManager } from "./core/secretsManager";
import { CertificateError, getErrorDetail } from "./error";
import { Remote } from "./remote";
import { toSafeHost } from "./util";
import { WorkspaceProvider, WorkspaceQuery } from "./workspacesProvider";

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

	const pathResolver = new PathResolver(
		ctx.globalStorageUri.fsPath,
		ctx.logUri.fsPath,
	);
	const mementoManager = new MementoManager(ctx.globalState);
	const secretsManager = new SecretsManager(ctx.secrets);

	const output = vscode.window.createOutputChannel("Coder", { log: true });

	// Try to clear this flag ASAP
	const isFirstConnect = await mementoManager.getAndClearFirstConnect();

	// This client tracks the current login and will be used through the life of
	// the plugin to poll workspaces for the current login, as well as being used
	// in commands that operate on the current login.
	const url = mementoManager.getUrl();
	const client = CoderApi.create(
		url || "",
		await secretsManager.getSessionToken(),
		output,
		() => vscode.workspace.getConfiguration(),
	);

	const myWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.Mine,
		client,
		output,
		5,
	);
	const allWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.All,
		client,
		output,
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
					mementoManager.getUrl(),
				);
				if (url) {
					client.setHost(url);
					await mementoManager.setUrl(url);
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
				const token = needToken(vscode.workspace.getConfiguration())
					? params.get("token")
					: (params.get("token") ?? "");
				if (token) {
					client.setSessionToken(token);
					await secretsManager.setSessionToken(token);
				}

				// Store on disk to be used by the cli.
				await cliManager.configure(toSafeHost(url), url, token);

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
					mementoManager.getUrl(),
				);
				if (url) {
					client.setHost(url);
					await mementoManager.setUrl(url);
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
				const token = needToken(vscode.workspace.getConfiguration())
					? params.get("token")
					: (params.get("token") ?? "");

				// Store on disk to be used by the cli.
				await cliManager.configure(toSafeHost(url), url, token);

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

	const cliManager = new CliManager(vscodeProposed, output, pathResolver);

	// Register globally available commands.  Many of these have visibility
	// controlled by contexts, see `when` in the package.json.
	const commands = new Commands(
		vscodeProposed,
		client,
		output,
		pathResolver,
		mementoManager,
		secretsManager,
		cliManager,
	);
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
			output,
			commands,
			ctx.extensionMode,
			pathResolver,
			cliManager,
		);
		try {
			const details = await remote.setup(
				vscodeProposed.env.remoteAuthority,
				isFirstConnect,
			);
			if (details) {
				// Authenticate the plugin client which is used in the sidebar to display
				// workspaces belonging to this deployment.
				client.setHost(details.url);
				client.setSessionToken(details.token);
			}
		} catch (ex) {
			if (ex instanceof CertificateError) {
				output.warn(ex.x509Err || ex.message);
				await ex.showModal("Failed to open workspace");
			} else if (isAxiosError(ex)) {
				const msg = getErrorMessage(ex, "None");
				const detail = getErrorDetail(ex) || "None";
				const urlString = axios.getUri(ex.config);
				const method = ex.config?.method?.toUpperCase() || "request";
				const status = ex.response?.status || "None";
				const message = `API ${method} to '${urlString}' failed.\nStatus code: ${status}\nMessage: ${msg}\nDetail: ${detail}`;
				output.warn(message);
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
				output.warn(message);
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
	const baseUrl = client.getAxiosInstance().defaults.baseURL;
	if (baseUrl) {
		output.info(`Logged in to ${baseUrl}; checking credentials`);
		client
			.getAuthenticatedUser()
			.then(async (user) => {
				if (user && user.roles) {
					output.info("Credentials are valid");
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
					output.warn("No error, but got unexpected response", user);
				}
			})
			.catch((error) => {
				// This should be a failure to make the request, like the header command
				// errored.
				output.warn("Failed to check user authentication", error);
				vscode.window.showErrorMessage(
					`Failed to check user authentication: ${error.message}`,
				);
			})
			.finally(() => {
				vscode.commands.executeCommand("setContext", "coder.loaded", true);
			});
	} else {
		output.info("Not currently logged in");
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
