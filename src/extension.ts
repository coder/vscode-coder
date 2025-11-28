"use strict";

import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as vscode from "vscode";

import { errToStr } from "./api/api-helper";
import { CoderApi } from "./api/coderApi";
import { attachOAuthInterceptors } from "./api/oauthInterceptors";
import { needToken } from "./api/utils";
import { Commands } from "./commands";
import { ServiceContainer } from "./core/container";
import { type Deployment } from "./core/deployment";
import { type SecretsManager } from "./core/secretsManager";
import { CertificateError, getErrorDetail } from "./error";
import { OAuthSessionManager } from "./oauth/sessionManager";
import { CALLBACK_PATH } from "./oauth/utils";
import { maybeAskUrl } from "./promptUtils";
import { Remote } from "./remote/remote";
import { getRemoteSshExtension } from "./remote/sshExtension";
import { toSafeHost } from "./util";
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
		vscodeProposed = extensionRequire("vscode");
	} else {
		vscode.window.showErrorMessage(
			"Remote SSH extension not found, this may not work as expected.\n" +
				// NB should we link to documentation or marketplace?
				"Please install your choice of Remote SSH extension from the VS Code Marketplace.",
		);
	}

	const serviceContainer = new ServiceContainer(ctx, vscodeProposed);
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

	// Create OAuth session manager with login coordinator
	const oauthSessionManager = await OAuthSessionManager.create(
		deployment,
		serviceContainer,
		ctx.extension.id,
	);
	ctx.subscriptions.push(oauthSessionManager);

	// This client tracks the current login and will be used through the life of
	// the plugin to poll workspaces for the current login, as well as being used
	// in commands that operate on the current login.
	const client = CoderApi.create(
		deployment?.url || "",
		await secretsManager.getSessionToken(deployment?.label ?? ""),
		output,
	);
	ctx.subscriptions.push(client);
	attachOAuthInterceptors(client, output, oauthSessionManager);

	const myWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.Mine,
		client,
		output,
		5,
	);
	ctx.subscriptions.push(myWorkspacesProvider);

	const allWorkspacesProvider = new WorkspaceProvider(
		WorkspaceQuery.All,
		client,
		output,
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

	// Listen for deployment auth changes (token updates) for the current deployment
	// This listener is re-registered when the user logs into a different deployment
	let authChangeDisposable: vscode.Disposable | undefined;
	const registerAuthListener = (deploymentLabel: string | undefined) => {
		authChangeDisposable?.dispose();

		if (!deploymentLabel) {
			return;
		}

		output.debug("Registering auth listener for deployment", deploymentLabel);
		authChangeDisposable = secretsManager.onDidChangeSessionAuth(
			deploymentLabel,
			(auth) => {
				client.setCredentials(auth?.url, auth?.token);

				// Update authentication context for current deployment
				contextManager.set("coder.authenticated", auth !== undefined);
			},
		);
	};

	// Initialize auth listener for current deployment
	registerAuthListener(deployment?.label);
	ctx.subscriptions.push({ dispose: () => authChangeDisposable?.dispose() });

	// Handle vscode:// URIs.
	const uriHandler = vscode.window.registerUriHandler({
		handleUri: async (uri) => {
			const params = new URLSearchParams(uri.query);

			if (uri.path === CALLBACK_PATH) {
				const code = params.get("code");
				const state = params.get("state");
				const error = params.get("error");
				await oauthSessionManager.handleCallback(code, state, error);
				return;
			}

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

				await setupDeploymentFromUri(params, client, serviceContainer);

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

				await setupDeploymentFromUri(params, client, serviceContainer);

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
	ctx.subscriptions.push(uriHandler);

	// Register globally available commands.  Many of these have visibility
	// controlled by contexts, see `when` in the package.json.
	const commands = new Commands(serviceContainer, client, oauthSessionManager);
	ctx.subscriptions.push(
		vscode.commands.registerCommand(
			"coder.login",
			commands.login.bind(commands),
		),
		vscode.commands.registerCommand(
			"coder.logout",
			commands.logout.bind(commands),
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
			myWorkspacesProvider.fetchAndRefresh();
			allWorkspacesProvider.fetchAndRefresh();
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
		vscode.commands.registerCommand("coder.debug.listDeployments", () =>
			listStoredDeployments(secretsManager),
		),
	);

	const remote = new Remote(serviceContainer, commands, ctx);

	// Listen for deployment changes from other windows (cross-window sync)
	ctx.subscriptions.push(
		secretsManager.onDidChangeCurrentDeployment(async ({ deployment }) => {
			output.info("Deployment changed from another window");

			// Update client
			if (deployment) {
				const token = await secretsManager.getSessionToken(deployment.label);
				client.setCredentials(deployment.url, token);
				await oauthSessionManager.setDeployment(deployment);
			} else {
				client.setCredentials(undefined, undefined);
				oauthSessionManager.clearDeployment();
			}
			registerAuthListener(deployment?.label);

			// Update context
			contextManager.set("coder.authenticated", Boolean(deployment));

			// Refresh workspaces
			myWorkspacesProvider.fetchAndRefresh();
			allWorkspacesProvider.fetchAndRefresh();
		}),
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
	if (remoteSshExtension && vscodeProposed.env.remoteAuthority) {
		try {
			const details = await remote.setup(
				vscodeProposed.env.remoteAuthority,
				isFirstConnect,
				remoteSshExtension.id,
			);
			if (details) {
				ctx.subscriptions.push(details);

				// Set client host/token immediately for subsequent operations.
				client.setCredentials(details.url, details.token);

				// Persist and sync deployment across windows
				await secretsManager.setCurrentDeployment({
					url: details.url,
					label: details.label,
				});
				await mementoManager.addToUrlHistory(details.url);
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
			.then((user) => {
				if (user && user.roles) {
					output.info("Credentials are valid");
					contextManager.set("coder.authenticated", true);
					if (user.roles.find((role) => role.name === "owner")) {
						contextManager.set("coder.isOwner", true);
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
				commands.login({ url: defaultUrl, autoLogin: true });
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
		const migratedLabel = await secretsManager.migrateFromLegacyStorage();

		if (migratedLabel) {
			output.info(
				`Successfully migrated auth storage to label-based format (label: ${migratedLabel})`,
			);
		}
	} catch (error) {
		output.error(
			`Auth storage migration failed: ${error}. You may need to log in again.`,
		);
	}
}

async function showTreeViewSearch(id: string): Promise<void> {
	await vscode.commands.executeCommand(`${id}.focus`);
	await vscode.commands.executeCommand("list.find");
}

/**
 * Sets up deployment from URI parameters. Handles URL prompting, client setup,
 * and token storage. Throws if user cancels URL input.
 *
 * Sets client host/token immediately for subsequent operations.
 * Other updates (auth listener, OAuth manager, context, workspaces) are handled
 * asynchronously by the onDidChangeCurrentDeployment listener.
 */
async function setupDeploymentFromUri(
	params: URLSearchParams,
	client: CoderApi,
	serviceContainer: ServiceContainer,
): Promise<Deployment> {
	const secretsManager = serviceContainer.getSecretsManager();
	const mementoManager = serviceContainer.getMementoManager();
	const currentDeployment = await secretsManager.getCurrentDeployment();

	// We are not guaranteed that the URL we currently have is for the URL
	// this workspace belongs to, or that we even have a URL at all (the
	// queries will default to localhost) so ask for it if missing.
	// Pre-populate in case we do have the right URL so the user can just
	// hit enter and move on.
	const url = await maybeAskUrl(
		mementoManager,
		params.get("url"),
		currentDeployment?.url,
	);
	if (!url) {
		throw new Error("url must be provided or specified as a query parameter");
	}

	const label = toSafeHost(url);

	// If the token is missing we will get a 401 later and the user will be
	// prompted to sign in again, so we do not need to ensure it is set now.
	// For non-token auth, we write a blank token since the `vscodessh`
	// command currently always requires a token file. However, if there is
	// a query parameter for non-token auth go ahead and use it anyway;
	const token = await getToken(params, label, secretsManager);
	client.setCredentials(url, token);
	if (token) {
		await secretsManager.setSessionAuth(label, { url, token });
	}

	// Persist and sync deployment across windows
	await secretsManager.setCurrentDeployment({ url, label });
	await mementoManager.addToUrlHistory(url);

	return { url, label };
}

async function getToken(
	params: URLSearchParams,
	label: string,
	secretsManager: SecretsManager,
): Promise<string | undefined> {
	const paramsToken = params.get("token");
	if (paramsToken !== null) {
		// Always prefer the passed token if set
		return paramsToken;
	}

	if (needToken(vscode.workspace.getConfiguration())) {
		return await secretsManager.getSessionToken(label);
	}
	return "";
}

async function listStoredDeployments(
	secretsManager: SecretsManager,
): Promise<void> {
	const labels = secretsManager.getKnownLabels();
	if (labels.length === 0) {
		vscode.window.showInformationMessage("No deployments stored.");
		return;
	}

	const selected = await vscode.window.showQuickPick(
		labels.map((label) => ({ label, description: "Click to forget" })),
		{ placeHolder: "Select a deployment to forget" },
	);

	if (selected) {
		await secretsManager.clearAllAuthData(selected.label);
		vscode.window.showInformationMessage(
			`Cleared auth data for ${selected.label}`,
		);
	}
}
