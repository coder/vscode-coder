import { type Api } from "coder/site/src/api/api";
import { getErrorMessage } from "coder/site/src/api/errors";
import {
	type User,
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";

import { createWorkspaceIdentifier, extractAgents } from "./api/api-helper";
import { CoderApi } from "./api/coderApi";
import { needToken } from "./api/utils";
import { type CliManager } from "./core/cliManager";
import { type ServiceContainer } from "./core/container";
import { type ContextManager } from "./core/contextManager";
import { type MementoManager } from "./core/mementoManager";
import { type PathResolver } from "./core/pathResolver";
import { type SecretsManager } from "./core/secretsManager";
import { CertificateError } from "./error";
import { getGlobalFlags } from "./globalFlags";
import { type Logger } from "./logging/logger";
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
	// These will only be populated when actively connected to a workspace and are
	// used in commands.  Because commands can be executed by the user, it is not
	// possible to pass in arguments, so we have to store the current workspace
	// and its client somewhere, separately from the current globally logged-in
	// client, since you can connect to workspaces not belonging to whatever you
	// are logged into (for convenience; otherwise the recents menu can be a pain
	// if you use multiple deployments).
	public workspace?: Workspace;
	public workspaceLogPath?: string;
	public workspaceRestClient?: Api;

	public constructor(
		serviceContainer: ServiceContainer,
		private readonly restClient: Api,
	) {
		this.vscodeProposed = serviceContainer.getVsCodeProposed();
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.mementoManager = serviceContainer.getMementoManager();
		this.secretsManager = serviceContainer.getSecretsManager();
		this.cliManager = serviceContainer.getCliManager();
		this.contextManager = serviceContainer.getContextManager();
	}

	/**
	 * Find the requested agent if specified, otherwise return the agent if there
	 * is only one or ask the user to pick if there are multiple.  Return
	 * undefined if the user cancels.
	 */
	public async maybeAskAgent(
		agents: WorkspaceAgent[],
		filter?: string,
	): Promise<WorkspaceAgent | undefined> {
		const filteredAgents = filter
			? agents.filter((agent) => agent.name === filter)
			: agents;
		if (filteredAgents.length === 0) {
			throw new Error("Workspace has no matching agents");
		} else if (filteredAgents.length === 1) {
			return filteredAgents[0];
		} else {
			const quickPick = vscode.window.createQuickPick();
			quickPick.title = "Select an agent";
			quickPick.busy = true;
			const agentItems: vscode.QuickPickItem[] = filteredAgents.map((agent) => {
				let icon = "$(debug-start)";
				if (agent.status !== "connected") {
					icon = "$(debug-stop)";
				}
				return {
					alwaysShow: true,
					label: `${icon} ${agent.name}`,
					detail: `${agent.name} • Status: ${agent.status}`,
				};
			});
			quickPick.items = agentItems;
			quickPick.busy = false;
			quickPick.show();

			const selected = await new Promise<WorkspaceAgent | undefined>(
				(resolve) => {
					quickPick.onDidHide(() => resolve(undefined));
					quickPick.onDidChangeSelection((selected) => {
						if (selected.length < 1) {
							return resolve(undefined);
						}
						const agent = filteredAgents[quickPick.items.indexOf(selected[0])];
						resolve(agent);
					});
				},
			);
			quickPick.dispose();
			return selected;
		}
	}

	/**
	 * Ask the user for the URL, letting them choose from a list of recent URLs or
	 * CODER_URL or enter a new one.  Undefined means the user aborted.
	 */
	private async askURL(selection?: string): Promise<string | undefined> {
		const defaultURL = vscode.workspace
			.getConfiguration()
			.get<string>("coder.defaultUrl")
			?.trim();
		const quickPick = vscode.window.createQuickPick();
		quickPick.value =
			selection || defaultURL || process.env.CODER_URL?.trim() || "";
		quickPick.placeholder = "https://example.coder.com";
		quickPick.title = "Enter the URL of your Coder deployment.";

		// Initial items.
		quickPick.items = this.mementoManager
			.withUrlHistory(defaultURL, process.env.CODER_URL)
			.map((url) => ({
				alwaysShow: true,
				label: url,
			}));

		// Quick picks do not allow arbitrary values, so we add the value itself as
		// an option in case the user wants to connect to something that is not in
		// the list.
		quickPick.onDidChangeValue((value) => {
			quickPick.items = this.mementoManager
				.withUrlHistory(defaultURL, process.env.CODER_URL, value)
				.map((url) => ({
					alwaysShow: true,
					label: url,
				}));
		});

		quickPick.show();

		const selected = await new Promise<string | undefined>((resolve) => {
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.onDidChangeSelection((selected) => resolve(selected[0]?.label));
		});
		quickPick.dispose();
		return selected;
	}

	/**
	 * Ask the user for the URL if it was not provided, letting them choose from a
	 * list of recent URLs or the default URL or CODER_URL or enter a new one, and
	 * normalizes the returned URL.  Undefined means the user aborted.
	 */
	public async maybeAskUrl(
		providedUrl: string | undefined | null,
		lastUsedUrl?: string,
	): Promise<string | undefined> {
		let url = providedUrl || (await this.askURL(lastUsedUrl));
		if (!url) {
			// User aborted.
			return undefined;
		}

		// Normalize URL.
		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			// Default to HTTPS if not provided so URLs can be typed more easily.
			url = "https://" + url;
		}
		while (url.endsWith("/")) {
			url = url.substring(0, url.length - 1);
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
		token?: string;
		label?: string;
		autoLogin?: boolean;
	}): Promise<void> {
		if (this.contextManager.get("coder.authenticated")) {
			return;
		}
		this.logger.info("Logging in");

		const url = await this.maybeAskUrl(args?.url);
		if (!url) {
			return; // The user aborted.
		}

		// It is possible that we are trying to log into an old-style host, in which
		// case we want to write with the provided blank label instead of generating
		// a host label.
		const label = args?.label === undefined ? toSafeHost(url) : args.label;

		// Try to get a token from the user, if we need one, and their user.
		const autoLogin = args?.autoLogin === true;
		const res = await this.maybeAskToken(url, args?.token, autoLogin);
		if (!res) {
			return; // The user aborted, or unable to auth.
		}

		// The URL is good and the token is either good or not required; authorize
		// the global client.
		this.restClient.setHost(url);
		this.restClient.setSessionToken(res.token);

		// Store these to be used in later sessions.
		await this.mementoManager.setUrl(url);
		await this.secretsManager.setSessionToken(res.token);

		// Store on disk to be used by the cli.
		await this.cliManager.configure(label, url, res.token);

		// These contexts control various menu items and the sidebar.
		this.contextManager.set("coder.authenticated", true);
		if (res.user.roles.find((role) => role.name === "owner")) {
			this.contextManager.set("coder.isOwner", true);
		}

		vscode.window
			.showInformationMessage(
				`Welcome to Coder, ${res.user.username}!`,
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

		await this.secretsManager.triggerLoginStateChange("login");
		// Fetch workspaces for the new deployment.
		vscode.commands.executeCommand("coder.refreshWorkspaces");
	}

	/**
	 * If necessary, ask for a token, and keep asking until the token has been
	 * validated.  Return the token and user that was fetched to validate the
	 * token.  Null means the user aborted or we were unable to authenticate with
	 * mTLS (in the latter case, an error notification will have been displayed).
	 */
	private async maybeAskToken(
		url: string,
		token: string | undefined,
		isAutoLogin: boolean,
	): Promise<{ user: User; token: string } | null> {
		const client = CoderApi.create(url, token, this.logger);
		const needsToken = needToken(vscode.workspace.getConfiguration());
		if (!needsToken || token) {
			try {
				const user = await client.getAuthenticatedUser();
				// For non-token auth, we write a blank token since the `vscodessh`
				// command currently always requires a token file.
				// For token auth, we have valid access so we can just return the user here
				return { token: needsToken && token ? token : "", user };
			} catch (err) {
				const message = getErrorMessage(err, "no response from the server");
				if (isAutoLogin) {
					this.logger.warn("Failed to log in to Coder server:", message);
				} else {
					this.vscodeProposed.window.showErrorMessage(
						"Failed to log in to Coder server",
						{
							detail: message,
							modal: true,
							useCustom: true,
						},
					);
				}
				// Invalid certificate, most likely.
				return null;
			}
		}

		// This prompt is for convenience; do not error if they close it since
		// they may already have a token or already have the page opened.
		await vscode.env.openExternal(vscode.Uri.parse(`${url}/cli-auth`));

		// For token auth, start with the existing token in the prompt or the last
		// used token.  Once submitted, if there is a failure we will keep asking
		// the user for a new token until they quit.
		let user: User | undefined;
		const validatedToken = await vscode.window.showInputBox({
			title: "Coder API Key",
			password: true,
			placeHolder: "Paste your API key.",
			value: token || (await this.secretsManager.getSessionToken()),
			ignoreFocusOut: true,
			validateInput: async (value) => {
				if (!value) {
					return null;
				}
				client.setSessionToken(value);
				try {
					user = await client.getAuthenticatedUser();
				} catch (err) {
					// For certificate errors show both a notification and add to the
					// text under the input box, since users sometimes miss the
					// notification.
					if (err instanceof CertificateError) {
						err.showNotification();

						return {
							message: err.x509Err || err.message,
							severity: vscode.InputBoxValidationSeverity.Error,
						};
					}
					// This could be something like the header command erroring or an
					// invalid session token.
					const message = getErrorMessage(err, "no response from the server");
					return {
						message: "Failed to authenticate: " + message,
						severity: vscode.InputBoxValidationSeverity.Error,
					};
				}
			},
		});

		if (validatedToken && user) {
			return { token: validatedToken, user };
		}

		// User aborted.
		return null;
	}

	/**
	 * View the logs for the currently connected workspace.
	 */
	public async viewLogs(): Promise<void> {
		if (!this.workspaceLogPath) {
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
			return;
		}
		const uri = vscode.Uri.file(this.workspaceLogPath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	}

	/**
	 * Log out from the currently logged-in deployment.
	 */
	public async logout(): Promise<void> {
		const url = this.mementoManager.getUrl();
		if (!url) {
			// Sanity check; command should not be available if no url.
			throw new Error("You are not logged in");
		}
		await this.forceLogout();
	}

	public async forceLogout(): Promise<void> {
		if (!this.contextManager.get("coder.authenticated")) {
			return;
		}
		this.logger.info("Logging out");
		// Clear from the REST client.  An empty url will indicate to other parts of
		// the code that we are logged out.
		this.restClient.setHost("");
		this.restClient.setSessionToken("");

		// Clear from memory.
		await this.mementoManager.setUrl(undefined);
		await this.secretsManager.setSessionToken(undefined);

		this.contextManager.set("coder.authenticated", false);
		vscode.window
			.showInformationMessage("You've been logged out of Coder!", "Login")
			.then((action) => {
				if (action === "Login") {
					this.login();
				}
			});

		await this.secretsManager.triggerLoginStateChange("logout");
		// This will result in clearing the workspace list.
		vscode.commands.executeCommand("coder.refreshWorkspaces");
	}

	/**
	 * Create a new workspace for the currently logged-in deployment.
	 *
	 * Must only be called if currently logged in.
	 */
	public async createWorkspace(): Promise<void> {
		const uri = this.mementoManager.getUrl() + "/templates";
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
	public async navigateToWorkspace(item: OpenableTreeItem) {
		if (item) {
			const workspaceId = createWorkspaceIdentifier(item.workspace);
			const uri = this.mementoManager.getUrl() + `/@${workspaceId}`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else if (this.workspace && this.workspaceRestClient) {
			const baseUrl =
				this.workspaceRestClient.getAxiosInstance().defaults.baseURL;
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
	public async navigateToWorkspaceSettings(item: OpenableTreeItem) {
		if (item) {
			const workspaceId = createWorkspaceIdentifier(item.workspace);
			const uri = this.mementoManager.getUrl() + `/@${workspaceId}/settings`;
			await vscode.commands.executeCommand("vscode.open", uri);
		} else if (this.workspace && this.workspaceRestClient) {
			const baseUrl =
				this.workspaceRestClient.getAxiosInstance().defaults.baseURL;
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
			const baseUrl = this.restClient.getAxiosInstance().defaults.baseURL;
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
				const agent = await this.maybeAskAgent(agents);
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
				throw new Error("Unable to open unknown sidebar item");
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

					const url = this.mementoManager.getUrl();
					if (!url) {
						throw new Error("No coder url found for sidebar");
					}
					const binary = await this.cliManager.fetchBinary(
						this.restClient,
						toSafeHost(url),
					);

					const configDir = this.pathResolver.getGlobalConfigDir(
						toSafeHost(url),
					);
					const globalFlags = getGlobalFlags(
						vscode.workspace.getConfiguration(),
						configDir,
					);
					terminal.sendText(
						`${escapeCommandArg(binary)}${` ${globalFlags.join(" ")}`} ssh ${app.workspace_name}`,
					);
					await new Promise((resolve) => setTimeout(resolve, 5000));
					terminal.sendText(app.command ?? "");
					terminal.show(false);
				},
			);
		}
		// Check if app has a URL to open
		if (app.url) {
			return vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Opening ${app.name || "application"} in browser...`,
					cancellable: false,
				},
				async () => {
					await vscode.env.openExternal(vscode.Uri.parse(app.url!));
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
		const baseUrl = this.restClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("You are not logged in");
		}

		let workspace: Workspace | undefined;
		if (workspaceOwner && workspaceName) {
			workspace = await this.restClient.getWorkspaceByOwnerAndName(
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
		const agent = await this.maybeAskAgent(agents, agentName);
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
		const baseUrl = this.restClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("You are not logged in");
		}

		const remoteAuthority = toRemoteAuthority(
			baseUrl,
			workspaceOwner,
			workspaceName,
			workspaceAgent,
		);

		const hostPath = localWorkspaceFolder ? localWorkspaceFolder : undefined;
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
		if (!this.workspace || !this.workspaceRestClient) {
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
			"Cancel",
		);
		if (action === "Update") {
			await this.workspaceRestClient.updateWorkspaceVersion(this.workspace);
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
			this.restClient
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
					return;
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
			const resources = await this.restClient.getTemplateVersionResources(
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
