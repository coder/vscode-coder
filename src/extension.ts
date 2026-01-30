"use strict";

import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as vscode from "vscode";

import { errToStr } from "./api/api-helper";
import { AuthInterceptor } from "./api/authInterceptor";
import { CoderApi } from "./api/coderApi";
import { Commands } from "./commands";
import { ServiceContainer } from "./core/container";
import { DeploymentManager } from "./deployment/deploymentManager";
import { CertificateError } from "./error/certificateError";
import { getErrorDetail, toError } from "./error/errorUtils";
import { OAuthSessionManager } from "./oauth/sessionManager";
import { Remote } from "./remote/remote";
import { getRemoteSshExtension } from "./remote/sshExtension";
import { registerUriHandler } from "./uri/uriHandler";
import { initVscodeProposed } from "./vscodeProposed";
import { TasksPanel } from "./webviews/tasks/TasksPanel";
import {
	WorkspaceProvider,
	WorkspaceQuery,
} from "./workspace/workspacesProvider";

const MY_WORKSPACES_TREE_ID = "myWorkspaces";
const ALL_WORKSPACES_TREE_ID = "allWorkspaces";

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	// The Remote SSH extension's proposed APIs are used to override the SSH host
	// name in VS Code itself. It's visually unappealing having a lengthy name!
	//
	// This is janky, but that's alright since it provides such minimal
	// functionality to the extension.
	//
	// Cursor and VSCode are covered by ms remote, and the only other is windsurf for now
	// Means that vscodium is not supported by this for now

	const remoteSshExtension = getRemoteSshExtension();

	let vscodeProposed: typeof vscode = vscode;

	if (remoteSshExtension) {
		const extensionRequire = createRequire(
			path.join(remoteSshExtension.extensionPath, "package.json"),
		);
		vscodeProposed = extensionRequire("vscode") as typeof vscode;
	} else {
		vscode.window.showErrorMessage(
			"Remote SSH extension not found, this may not work as expected.\n" +
				// NB should we link to documentation or marketplace?
				"Please install your choice of Remote SSH extension from the VS Code Marketplace.",
		);
	}

	// Initialize the global vscodeProposed module for use throughout the extension
	initVscodeProposed(vscodeProposed);

	const serviceContainer = new ServiceContainer(ctx);
	ctx.subscriptions.push(serviceContainer);

	const output = serviceContainer.getLogger();
	const mementoManager = serviceContainer.getMementoManager();
	const secretsManager = serviceContainer.getSecretsManager();
	const contextManager = serviceContainer.getContextManager();

	// Migrate auth storage from old flat format to new label-based format
	await migrateAuthStorage(serviceContainer);

	// Try to clear this flag ASAP
	const isFirstConnect = await mementoManager.getAndClearFirstConnect();

	const deployment = await secretsManager.getCurrentDeployment();

	// Shared handler for auth failures (used by interceptor + session manager)
	const handleAuthFailure = (): Promise<void> => {
		deploymentManager.suspendSession();
		vscode.window
			.showWarningMessage(
				"Session expired. You have been signed out.",
				"Log In",
			)
			.then(async (action) => {
				if (action === "Log In") {
					try {
						await commands.login({
							url: deploymentManager.getCurrentDeployment()?.url,
						});
					} catch (err) {
						output.error("Login failed", err);
					}
				}
			});
		return Promise.resolve();
	};

	// Create OAuth session manager - callback handles background refresh failures
	const oauthSessionManager = OAuthSessionManager.create(
		deployment,
		serviceContainer,
		handleAuthFailure,
	);
	ctx.subscriptions.push(oauthSessionManager);

	// This client tracks the current login and will be used through the life of
	// the plugin to poll workspaces for the current login, as well as being used
	// in commands that operate on the current login.
	const client = CoderApi.create(
		deployment?.url || "",
		(await secretsManager.getSessionAuth(deployment?.safeHostname ?? ""))
			?.token,
		output,
	);
	ctx.subscriptions.push(client);

	// Handles 401 responses (OAuth and otherwise)
	const authInterceptor = new AuthInterceptor(
		client,
		output,
		oauthSessionManager,
		secretsManager,
		async () => {
			await handleAuthFailure();
			return false;
		},
	);
	ctx.subscriptions.push(authInterceptor);

	const isAuthenticated = () => contextManager.get("coder.authenticated");

	const myWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.Mine,
		client,
		output,
		isAuthenticated,
		5,
	);
	ctx.subscriptions.push(myWorkspacesProvider);

	const allWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.All,
		client,
		output,
		isAuthenticated,
	);
	ctx.subscriptions.push(allWorkspacesProvider);

	// createTreeView, unlike registerTreeDataProvider, gives us the tree view API
	// (so we can see when it is visible) but otherwise they have the same effect.
	const myWsTree = vscode.window.createTreeView(MY_WORKSPACES_TREE_ID, {
		treeDataProvider: myWorkspacesProvider,
	});
	ctx.subscriptions.push(myWsTree);
	myWorkspacesProvider.setVisibility(myWsTree.visible);
	myWsTree.onDidChangeVisibility(
		(event) => {
			myWorkspacesProvider.setVisibility(event.visible);
		},
		undefined,
		ctx.subscriptions,
	);

	const allWsTree = vscode.window.createTreeView(ALL_WORKSPACES_TREE_ID, {
		treeDataProvider: allWorkspacesProvider,
	});
	ctx.subscriptions.push(allWsTree);
	allWorkspacesProvider.setVisibility(allWsTree.visible);
	allWsTree.onDidChangeVisibility(
		(event) => {
			allWorkspacesProvider.setVisibility(event.visible);
		},
		undefined,
		ctx.subscriptions,
	);

	// Create deployment manager to centralize deployment state management
	const deploymentManager = DeploymentManager.create(
		serviceContainer,
		client,
		oauthSessionManager,
		[myWorkspacesProvider, allWorkspacesProvider],
	);
	ctx.subscriptions.push(deploymentManager);

	// Register globally available commands.  Many of these have visibility
	// controlled by contexts, see `when` in the package.json.
	const commands = new Commands(serviceContainer, client, deploymentManager);

	// Register Tasks webview panel
	const tasksProvider = new TasksPanel(ctx.extensionUri);
	ctx.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			TasksPanel.viewType,
			tasksProvider,
		),
	);

	ctx.subscriptions.push(
		registerUriHandler(serviceContainer, deploymentManager, commands),
		vscode.commands.registerCommand(
			"coder.login",
			commands.login.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.logout",
			commands.logout.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.switchDeployment",
			commands.switchDeployment.bind(commands),
		),
		vscode.commands.registerCommand("coder.open", commands.open.bind(commands)),
		vscode.commands.registerCommand(
			"coder.openDevContainer",
			commands.openDevContainer.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.openFromSidebar",
			commands.openFromSidebar.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.openAppStatus",
			commands.openAppStatus.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.workspace.update",
			commands.updateWorkspace.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.createWorkspace",
			commands.createWorkspace.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.navigateToWorkspace",
			commands.navigateToWorkspace.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.navigateToWorkspaceSettings",
			commands.navigateToWorkspaceSettings.bind(commands),
		),
		vscode.commands.registerCommand("coder.refreshWorkspaces", () => {
			void myWorkspacesProvider.fetchAndRefresh();
			void allWorkspacesProvider.fetchAndRefresh();
		}),
		vscode.commands.registerCommand(
			"coder.viewLogs",
			commands.viewLogs.bind(commands),
		),
		vscode.commands.registerCommand("coder.searchMyWorkspaces", async () =>
			showTreeViewSearch(MY_WORKSPACES_TREE_ID),
		),
		vscode.commands.registerCommand("coder.searchAllWorkspaces", async () =>
			showTreeViewSearch(ALL_WORKSPACES_TREE_ID),
		),
		vscode.commands.registerCommand(
			"coder.manageCredentials",
			commands.manageCredentials.bind(commands),
		),
	);

	const remote = new Remote(serviceContainer, commands, ctx);

	// Since the "onResolveRemoteAuthority:ssh-remote" activation event exists
	// in package.json we're able to perform actions before the authority is
	// resolved by the remote SSH extension.
	//
	// In addition, if we don't have a remote SSH extension, we skip this
	// activation event. This may allow the user to install the extension
	// after the Coder extension is installed, instead of throwing a fatal error
	// (this would require the user to uninstall the Coder extension and
	// reinstall after installing the remote SSH extension, which is annoying)
	if (remoteSshExtension && vscodeProposed.env.remoteAuthority) {
		try {
			const details = await remote.setup(
				vscodeProposed.env.remoteAuthority,
				isFirstConnect,
				remoteSshExtension.id,
			);
			if (details) {
				ctx.subscriptions.push(details);

				await deploymentManager.setDeploymentIfValid({
					safeHostname: details.safeHostname,
					url: details.url,
					token: details.token,
				});
			}
		} catch (ex) {
			if (ex instanceof CertificateError) {
				output.warn(ex.detail);
				await ex.showNotification("Failed to open workspace", { modal: true });
			} else if (isAxiosError(ex)) {
				const msg = getErrorMessage(ex, "None");
				const detail = getErrorDetail(ex) || "None";
				const urlString = axios.getUri(ex.config);
				const method = ex.config?.method?.toUpperCase() || "request";
				const status = ex.response?.status ?? "None";
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

	// Initialize deployment manager with stored deployment (if any).
	// Skip if already set by remote.setup above.
	if (deploymentManager.getCurrentDeployment()) {
		contextManager.set("coder.loaded", true);
	} else if (deployment) {
		output.info(`Initializing deployment: ${deployment.url}`);
		deploymentManager
			.setDeploymentIfValid(deployment)
			// Failure is logged internally
			.then((success) => {
				if (success) {
					output.info("Deployment authenticated and set");
				}
			})
			.catch((error: unknown) => {
				output.warn("Failed to initialize deployment", error);
				const message = toError(error).message;
				vscode.window.showErrorMessage(
					`Failed to check user authentication: ${message}`,
				);
			})
			.finally(() => {
				contextManager.set("coder.loaded", true);
			});
	} else {
		output.info("Not currently logged in");
		contextManager.set("coder.loaded", true);

		// Handle autologin, if not already logged in.
		const cfg = vscode.workspace.getConfiguration();
		if (cfg.get("coder.autologin") === true) {
			const defaultUrl =
				cfg.get<string>("coder.defaultUrl")?.trim() ||
				process.env.CODER_URL?.trim();
			if (defaultUrl) {
				commands.login({ url: defaultUrl, autoLogin: true }).catch((error) => {
					output.error("Auto-login failed", error);
				});
			}
		}
	}
}

/**
 * Migrates old flat storage (sessionToken) to new label-based map storage.
 * This is a one-time operation that runs on extension activation.
 */
async function migrateAuthStorage(
	serviceContainer: ServiceContainer,
): Promise<void> {
	const secretsManager = serviceContainer.getSecretsManager();
	const output = serviceContainer.getLogger();

	try {
		const migratedHostname = await secretsManager.migrateFromLegacyStorage();

		if (migratedHostname) {
			output.info(
				`Successfully migrated auth storage (hostname: ${migratedHostname})`,
			);
		}
	} catch (error: unknown) {
		output.error(
			`Auth storage migration failed. You may need to log in again.`,
			error,
		);
	}
}

async function showTreeViewSearch(id: string): Promise<void> {
	await vscode.commands.executeCommand(`${id}.focus`);
	await vscode.commands.executeCommand("list.find");
}
