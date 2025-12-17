import {
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { createWorkspaceIdentifier, extractAgents } from "./api/api-helper";
import { type CoderApi } from "./api/coderApi";
import { getGlobalFlags } from "./cliConfig";
import { type CliManager } from "./core/cliManager";
import { type ServiceContainer } from "./core/container";
import { type ContextManager } from "./core/contextManager";
import { type MementoManager } from "./core/mementoManager";
import { type PathResolver } from "./core/pathResolver";
import { type SecretsManager } from "./core/secretsManager";
import { type DeploymentManager } from "./deployment/deploymentManager";
import { CertificateError } from "./error";
import { type Logger } from "./logging/logger";
import { type LoginCoordinator } from "./login/loginCoordinator";
import { maybeAskAgent, maybeAskUrl } from "./promptUtils";
import { escapeCommandArg, toRemoteAuthority, toSafeHost } from "./util";
import {
	AgentTreeItem,
	type OpenableTreeItem,
	WorkspaceTreeItem,
} from "./workspace/workspacesProvider";

export class Commands {
	private readonly vscodeProposed: typeof vscode;
	private readonly logger: Logger;
	private readonly pathResolver: PathResolver;
	private readonly mementoManager: MementoManager;
	private readonly secretsManager: SecretsManager;
	private readonly cliManager: CliManager;
	private readonly contextManager: ContextManager;
	private readonly loginCoordinator: LoginCoordinator;

	// These will only be populated when actively connected to a workspace and are
	// used in commands.  Because commands can be executed by the user, it is not
	// possible to pass in arguments, so we have to store the current workspace
	// and its client somewhere, separately from the current globally logged-in
	// client, since you can connect to workspaces not belonging to whatever you
	// are logged into (for convenience; otherwise the recents menu can be a pain
	// if you use multiple deployments).
	public workspace?: Workspace;
	public workspaceLogPath?: string;
	public remoteWorkspaceClient?: CoderApi;

	public constructor(
		serviceContainer: ServiceContainer,
		private readonly extensionClient: CoderApi,
		private readonly deploymentManager: DeploymentManager,
	) {
		this.vscodeProposed = serviceContainer.getVsCodeProposed();
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.mementoManager = serviceContainer.getMementoManager();
		this.secretsManager = serviceContainer.getSecretsManager();
		this.cliManager = serviceContainer.getCliManager();
		this.contextManager = serviceContainer.getContextManager();
		this.loginCoordinator = serviceContainer.getLoginCoordinator();
	}

	/**
	 * Get the current deployment, throwing if not logged in.
	 */
	private requireExtensionBaseUrl(): string {
		const url = this.extensionClient.getAxiosInstance().defaults.baseURL;
		if (!url) {
			throw new Error("You are not logged in");
		}
		return url;
	}

	/**
	 * Log into the provided deployment. If the deployment URL is not specified,
	 * ask for it first with a menu showing recent URLs along with the default URL
	 * and CODER_URL, if those are set.
	 */
	public async login(args?: {
		url?: string;
		autoLogin?: boolean;
	}): Promise<void> {
		if (this.deploymentManager.isAuthenticated()) {
			return;
		}
		this.logger.info("Logging in");

		const currentDeployment = await this.secretsManager.getCurrentDeployment();
		const url = await maybeAskUrl(
			this.mementoManager,
			args?.url,
			currentDeployment?.url,
		);
		if (!url) {
			return; // The user aborted.
		}

		const safeHostname = toSafeHost(url);
		this.logger.debug("Using hostname", safeHostname);

		const result = await this.loginCoordinator.ensureLoggedIn({
			safeHostname,
			url,
			autoLogin: args?.autoLogin,
		});

		if (!result.success) {
			return;
		}

		// Login might have happened in another process/window so we do not have the user yet.
		result.user ??= await this.extensionClient.getAuthenticatedUser();

		await this.deploymentManager.setDeployment({
			url,
			safeHostname,
			token: result.token,
			user: result.user,
		});

		vscode.window
			.showInformationMessage(
				`Welcome to Coder, ${result.user.username}!`,
				{
					detail:
						"You can now use the Coder extension to manage your Coder instance.",
				},
				"Open Workspace",
			)
			.then((action) => {
				if (action === "Open Workspace") {
					vscode.commands.executeCommand("coder.open");
				}
			});
		this.logger.debug("Login complete to deployment:", url);
	}

	/**
	 * View the logs for the currently connected workspace.
	 */
	public async viewLogs(): Promise<void> {
		if (this.workspaceLogPath) {
			// Return the connected deployment's log file.
			return this.openFile(this.workspaceLogPath);
		}

		const logDir = vscode.workspace
			.getConfiguration()
			.get<string>("coder.proxyLogDirectory");
		if (logDir) {
			try {
				const files = await fs.readdir(logDir);
				// Sort explicitly since fs.readdir order is platform-dependent
				const logFiles = files
					.filter((f) => f.endsWith(".log"))
					.sort((a, b) => a.localeCompare(b))
					.reverse();

				if (logFiles.length === 0) {
					vscode.window.showInformationMessage(
						"No log files found in the configured log directory.",
					);
					return;
				}

				const selected = await vscode.window.showQuickPick(logFiles, {
					title: "Select a log file to view",
				});

				if (selected) {
					await this.openFile(path.join(logDir, selected));
				}
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to read log directory: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else {
			vscode.window
				.showInformationMessage(
					"No logs available. Make sure to set coder.proxyLogDirectory to get logs.",
					"Open Settings",
				)
				.then((action) => {
					if (action === "Open Settings") {
						vscode.commands.executeCommand(
							"workbench.action.openSettings",
							"coder.proxyLogDirectory",
						);
					}
				});
		}
	}

	private async openFile(filePath: string): Promise<void> {
		const uri = vscode.Uri.file(filePath);
		await vscode.window.showTextDocument(uri);
	}

	/**
	 * Log out from the currently logged-in deployment.
	 */
	public async logout(): Promise<void> {
		if (!this.deploymentManager.isAuthenticated()) {
			return;
		}

		this.logger.info("Logging out");

		await this.deploymentManager.clearDeployment();

		vscode.window
			.showInformationMessage("You've been logged out of Coder!", "Login")
			.then((action) => {
				if (action === "Login") {
					this.login();
				}
			});

		this.logger.debug("Logout complete");
	}

	/**
	 * Create a new workspace for the currently logged-in deployment.
	 *
	 * Must only be called if currently logged in.
	 */
	public async createWorkspace(): Promise<void> {
		const baseUrl = this.requireExtensionBaseUrl();
		const uri = baseUrl + "/templates";
		await vscode.commands.executeCommand("vscode.open", uri);
	}

	/**
	 * Open a link to the workspace in the Coder dashboard.
	 *
	 * If passing in a workspace, it must belong to the currently logged-in
	 * deployment.
	 *
	 * Otherwise, the currently connected workspace is used (if any).
	 */
	public async navigateToWorkspace(item?: OpenableTreeItem) {
		if (item) {
			const baseUrl = this.requireExtensionBaseUrl();
			const workspaceId = createWorkspaceIdentifier(item.workspace);
			const uri = baseUrl + `/@${workspaceId}`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else if (this.workspace && this.remoteWorkspaceClient) {
			const baseUrl =
				this.remoteWorkspaceClient.getAxiosInstance().defaults.baseURL;
			const uri = `${baseUrl}/@${createWorkspaceIdentifier(this.workspace)}`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else {
			vscode.window.showInformationMessage("No workspace found.");
		}
	}

	/**
	 * Open a link to the workspace settings in the Coder dashboard.
	 *
	 * If passing in a workspace, it must belong to the currently logged-in
	 * deployment.
	 *
	 * Otherwise, the currently connected workspace is used (if any).
	 */
	public async navigateToWorkspaceSettings(item?: OpenableTreeItem) {
		if (item) {
			const baseUrl = this.requireExtensionBaseUrl();
			const workspaceId = createWorkspaceIdentifier(item.workspace);
			const uri = baseUrl + `/@${workspaceId}/settings`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else if (this.workspace && this.remoteWorkspaceClient) {
			const baseUrl =
				this.remoteWorkspaceClient.getAxiosInstance().defaults.baseURL;
			const uri = `${baseUrl}/@${createWorkspaceIdentifier(this.workspace)}/settings`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else {
			vscode.window.showInformationMessage("No workspace found.");
		}
	}

	/**
	 * Open a workspace or agent that is showing in the sidebar.
	 *
	 * This builds the host name and passes it to the VS Code Remote SSH
	 * extension.

	 * Throw if not logged into a deployment.
	 */
	public async openFromSidebar(item: OpenableTreeItem) {
		if (item) {
			const baseUrl = this.extensionClient.getAxiosInstance().defaults.baseURL;
			if (!baseUrl) {
				throw new Error("You are not logged in");
			}
			if (item instanceof AgentTreeItem) {
				await this.openWorkspace(
					baseUrl,
					item.workspace,
					item.agent,
					undefined,
					true,
				);
			} else if (item instanceof WorkspaceTreeItem) {
				const agents = await this.extractAgentsWithFallback(item.workspace);
				const agent = await maybeAskAgent(agents);
				if (!agent) {
					// User declined to pick an agent.
					return;
				}
				await this.openWorkspace(
					baseUrl,
					item.workspace,
					agent,
					undefined,
					true,
				);
			} else {
				throw new TypeError("Unable to open unknown sidebar item");
			}
		} else {
			// If there is no tree item, then the user manually ran this command.
			// Default to the regular open instead.
			return this.open();
		}
	}

	public async openAppStatus(app: {
		name?: string;
		url?: string;
		agent_name?: string;
		command?: string;
		workspace_name: string;
	}): Promise<void> {
		// Launch and run command in terminal if command is provided
		if (app.command) {
			return vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Connecting to AI Agent...`,
					cancellable: false,
				},
				async () => {
					const terminal = vscode.window.createTerminal(app.name);

					// If workspace_name is provided, run coder ssh before the command
					const baseUrl = this.requireExtensionBaseUrl();
					const safeHost = toSafeHost(baseUrl);
					const binary = await this.cliManager.fetchBinary(
						this.extensionClient,
						safeHost,
					);

					const configDir = this.pathResolver.getGlobalConfigDir(safeHost);
					const globalFlags = getGlobalFlags(
						vscode.workspace.getConfiguration(),
						configDir,
					);
					terminal.sendText(
						`${escapeCommandArg(binary)} ${globalFlags.join(" ")} ssh ${app.workspace_name}`,
					);
					await new Promise((resolve) => setTimeout(resolve, 5000));
					terminal.sendText(app.command ?? "");
					terminal.show(false);
				},
			);
		}

		// If no URL or command, show information about the app status
		vscode.window.showInformationMessage(`${app.name}`, {
			detail: `Agent: ${app.agent_name || "Unknown"}`,
		});
	}

	/**
	 * Open a workspace belonging to the currently logged-in deployment.
	 *
	 * If no workspace is provided, ask the user for one.  If no agent is
	 * provided, use the first or ask the user if there are multiple.
	 *
	 * Throw if not logged into a deployment or if a matching workspace or agent
	 * cannot be found.
	 */
	public async open(
		workspaceOwner?: string,
		workspaceName?: string,
		agentName?: string,
		folderPath?: string,
		openRecent?: boolean,
	): Promise<void> {
		const baseUrl = this.extensionClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("You are not logged in");
		}

		let workspace: Workspace | undefined;
		if (workspaceOwner && workspaceName) {
			workspace = await this.extensionClient.getWorkspaceByOwnerAndName(
				workspaceOwner,
				workspaceName,
			);
		} else {
			workspace = await this.pickWorkspace();
			if (!workspace) {
				// User declined to pick a workspace.
				return;
			}
		}

		const agents = await this.extractAgentsWithFallback(workspace);
		const agent = await maybeAskAgent(agents, agentName);
		if (!agent) {
			// User declined to pick an agent.
			return;
		}

		await this.openWorkspace(baseUrl, workspace, agent, folderPath, openRecent);
	}

	/**
	 * Open a devcontainer from a workspace belonging to the currently logged-in deployment.
	 *
	 * Throw if not logged into a deployment.
	 */
	public async openDevContainer(
		workspaceOwner: string,
		workspaceName: string,
		workspaceAgent: string,
		devContainerName: string,
		devContainerFolder: string,
		localWorkspaceFolder: string = "",
		localConfigFile: string = "",
	): Promise<void> {
		const baseUrl = this.extensionClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("You are not logged in");
		}

		const remoteAuthority = toRemoteAuthority(
			baseUrl,
			workspaceOwner,
			workspaceName,
			workspaceAgent,
		);

		const hostPath = localWorkspaceFolder || undefined;
		const configFile =
			hostPath && localConfigFile
				? {
						path: localConfigFile,
						scheme: "vscode-fileHost",
					}
				: undefined;
		const devContainer = Buffer.from(
			JSON.stringify({
				containerName: devContainerName,
				hostPath,
				configFile,
				localDocker: false,
			}),
			"utf-8",
		).toString("hex");

		const type = localWorkspaceFolder ? "dev-container" : "attached-container";
		const devContainerAuthority = `${type}+${devContainer}@${remoteAuthority}`;

		let newWindow = true;
		if (!vscode.workspace.workspaceFolders?.length) {
			newWindow = false;
		}

		// Only set the memento when opening a new folder
		await this.mementoManager.setFirstConnect();
		await vscode.commands.executeCommand(
			"vscode.openFolder",
			vscode.Uri.from({
				scheme: "vscode-remote",
				authority: devContainerAuthority,
				path: devContainerFolder,
			}),
			newWindow,
		);
	}

	/**
	 * Update the current workspace.  If there is no active workspace connection,
	 * this is a no-op.
	 */
	public async updateWorkspace(): Promise<void> {
		if (!this.workspace || !this.remoteWorkspaceClient) {
			return;
		}
		const action = await this.vscodeProposed.window.showWarningMessage(
			"Update Workspace",
			{
				useCustom: true,
				modal: true,
				detail: `Update ${createWorkspaceIdentifier(this.workspace)} to the latest version?\n\nUpdating will restart your workspace which stops any running processes and may result in the loss of unsaved work.`,
			},
			"Update",
		);
		if (action === "Update") {
			await this.remoteWorkspaceClient.updateWorkspaceVersion(this.workspace);
		}
	}

	/**
	 * Ask the user to select a workspace.  Return undefined if canceled.
	 */
	private async pickWorkspace(): Promise<Workspace | undefined> {
		const quickPick = vscode.window.createQuickPick();
		quickPick.value = "owner:me ";
		quickPick.placeholder = "owner:me template:go";
		quickPick.title = `Connect to a workspace`;
		let lastWorkspaces: readonly Workspace[];
		quickPick.onDidChangeValue((value) => {
			quickPick.busy = true;
			this.extensionClient
				.getWorkspaces({
					q: value,
				})
				.then((workspaces) => {
					lastWorkspaces = workspaces.workspaces;
					const items: vscode.QuickPickItem[] = workspaces.workspaces.map(
						(workspace) => {
							let icon = "$(debug-start)";
							if (workspace.latest_build.status !== "running") {
								icon = "$(debug-stop)";
							}
							const status =
								workspace.latest_build.status.substring(0, 1).toUpperCase() +
								workspace.latest_build.status.substring(1);
							return {
								alwaysShow: true,
								label: `${icon} ${workspace.owner_name} / ${workspace.name}`,
								detail: `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`,
							};
						},
					);
					quickPick.items = items;
					quickPick.busy = false;
				})
				.catch((ex) => {
					if (ex instanceof CertificateError) {
						ex.showNotification();
					}
				});
		});
		quickPick.show();
		return new Promise<Workspace | undefined>((resolve) => {
			quickPick.onDidHide(() => {
				resolve(undefined);
			});
			quickPick.onDidChangeSelection((selected) => {
				if (selected.length < 1) {
					return resolve(undefined);
				}
				const workspace = lastWorkspaces[quickPick.items.indexOf(selected[0])];
				resolve(workspace);
			});
		});
	}

	/**
	 * Return agents from the workspace.
	 *
	 * This function can return agents even if the workspace is off.  Use this to
	 * ensure we have an agent so we get a stable host name, because Coder will
	 * happily connect to the same agent with or without it in the URL (if it is
	 * the first) but VS Code will treat these as different sessions.
	 */
	private async extractAgentsWithFallback(
		workspace: Workspace,
	): Promise<WorkspaceAgent[]> {
		const agents = extractAgents(workspace.latest_build.resources);
		if (workspace.latest_build.status !== "running" && agents.length === 0) {
			// If we have no agents, the workspace may not be running, in which case
			// we need to fetch the agents through the resources API, as the
			// workspaces query does not include agents when off.
			this.logger.info("Fetching agents from template version");
			const resources = await this.extensionClient.getTemplateVersionResources(
				workspace.latest_build.template_version_id,
			);
			return extractAgents(resources);
		}
		return agents;
	}

	/**
	 * Given a workspace and agent, build the host name, find a directory to open,
	 * and pass both to the Remote SSH plugin in the form of a remote authority
	 * URI.
	 *
	 * If provided, folderPath is always used, otherwise expanded_directory from
	 * the agent is used.
	 */
	async openWorkspace(
		baseUrl: string,
		workspace: Workspace,
		agent: WorkspaceAgent,
		folderPath: string | undefined,
		openRecent: boolean = false,
	) {
		const remoteAuthority = toRemoteAuthority(
			baseUrl,
			workspace.owner_name,
			workspace.name,
			agent.name,
		);

		let newWindow = true;
		// Open in the existing window if no workspaces are open.
		if (!vscode.workspace.workspaceFolders?.length) {
			newWindow = false;
		}

		if (!folderPath) {
			folderPath = agent.expanded_directory;
		}

		// If the agent had no folder or we have been asked to open the most recent,
		// we can try to open a recently opened folder/workspace.
		if (!folderPath || openRecent) {
			const output: {
				workspaces: { folderUri: vscode.Uri; remoteAuthority: string }[];
			} = await vscode.commands.executeCommand("_workbench.getRecentlyOpened");
			const opened = output.workspaces.filter(
				// Remove recents that do not belong to this connection.  The remote
				// authority maps to a workspace/agent combination (using the SSH host
				// name).  There may also be some legacy connections that still may
				// reference a workspace without an agent name, which will be missed.
				(opened) => opened.folderUri?.authority === remoteAuthority,
			);

			// openRecent will always use the most recent.  Otherwise, if there are
			// multiple we ask the user which to use.
			if (opened.length === 1 || (opened.length > 1 && openRecent)) {
				folderPath = opened[0].folderUri.path;
			} else if (opened.length > 1) {
				const items = opened.map((f) => f.folderUri.path);
				folderPath = await vscode.window.showQuickPick(items, {
					title: "Select a recently opened folder",
				});
				if (!folderPath) {
					// User aborted.
					return;
				}
			}
		}

		// Only set the memento when opening a new folder/window
		await this.mementoManager.setFirstConnect();
		if (folderPath) {
			await vscode.commands.executeCommand(
				"vscode.openFolder",
				vscode.Uri.from({
					scheme: "vscode-remote",
					authority: remoteAuthority,
					path: folderPath,
				}),
				// Open this in a new window!
				newWindow,
			);
			return;
		}

		// This opens the workspace without an active folder opened.
		await vscode.commands.executeCommand("vscode.newWindow", {
			remoteAuthority: remoteAuthority,
			reuseWindow: !newWindow,
		});
	}
}
