import {
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as semver from "semver";
import * as vscode from "vscode";

import {
	createWorkspaceIdentifier,
	extractAgents,
	workspaceStatusLabel,
} from "./api/api-helper";
import { type CoderApi } from "./api/coderApi";
import { type CliManager } from "./core/cliManager";
import * as cliUtils from "./core/cliUtils";
import { type ServiceContainer } from "./core/container";
import { type MementoManager } from "./core/mementoManager";
import { type PathResolver } from "./core/pathResolver";
import { type SecretsManager } from "./core/secretsManager";
import { type DeploymentManager } from "./deployment/deploymentManager";
import { CertificateError } from "./error/certificateError";
import { toError } from "./error/errorUtils";
import { featureSetForVersion } from "./featureSet";
import { type Logger } from "./logging/logger";
import { type LoginCoordinator } from "./login/loginCoordinator";
import { withCancellableProgress, withProgress } from "./progress";
import { maybeAskAgent, maybeAskUrl } from "./promptUtils";
import {
	RECOMMENDED_SSH_SETTINGS,
	applySettingOverrides,
} from "./remote/sshOverrides";
import {
	getGlobalFlags,
	getGlobalShellFlags,
	resolveCliAuth,
} from "./settings/cli";
import { escapeCommandArg, toRemoteAuthority, toSafeHost } from "./util";
import { vscodeProposed } from "./vscodeProposed";
import {
	AgentTreeItem,
	type OpenableTreeItem,
	WorkspaceTreeItem,
} from "./workspace/workspacesProvider";

interface OpenOptions {
	workspaceOwner?: string;
	workspaceName?: string;
	agentName?: string;
	folderPath?: string;
	openRecent?: boolean;
	/** When false, an absent folderPath opens a bare remote window instead of
	 *  falling back to the agent's expanded_directory. Defaults to true. */
	useDefaultDirectory?: boolean;
}

const openDefaults = {
	openRecent: false,
	useDefaultDirectory: true,
} as const satisfies Partial<OpenOptions>;

export class Commands {
	private readonly logger: Logger;
	private readonly pathResolver: PathResolver;
	private readonly mementoManager: MementoManager;
	private readonly secretsManager: SecretsManager;
	private readonly cliManager: CliManager;
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
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.mementoManager = serviceContainer.getMementoManager();
		this.secretsManager = serviceContainer.getSecretsManager();
		this.cliManager = serviceContainer.getCliManager();
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
	 * Log into a deployment. If already authenticated, this is a no-op.
	 * If no URL is provided, shows a menu of recent URLs plus defaults.
	 */
	public async login(args?: {
		url?: string;
		autoLogin?: boolean;
	}): Promise<void> {
		if (this.deploymentManager.isAuthenticated()) {
			return;
		}
		await this.performLogin(args);
	}

	private async performLogin(args?: {
		url?: string;
		autoLogin?: boolean;
	}): Promise<void> {
		this.logger.debug("Logging in");

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
	 * Run a speed test against the currently connected workspace and display the
	 * results in a new editor document.
	 */
	public async speedTest(): Promise<void> {
		const workspace = this.workspace;
		const client = this.remoteWorkspaceClient;
		if (!workspace || !client) {
			vscode.window.showInformationMessage("No workspace connected.");
			return;
		}

		const duration = await vscode.window.showInputBox({
			title: "Speed Test Duration",
			prompt: "Duration for the speed test (e.g., 5s, 10s, 1m)",
			value: "5s",
		});
		if (duration === undefined) {
			return;
		}

		const result = await withCancellableProgress(
			async ({ signal }) => {
				const baseUrl = client.getAxiosInstance().defaults.baseURL;
				if (!baseUrl) {
					throw new Error("No deployment URL for the connected workspace");
				}
				const safeHost = toSafeHost(baseUrl);
				const binary = await this.cliManager.fetchBinary(client);
				const version = semver.parse(await cliUtils.version(binary));
				const featureSet = featureSetForVersion(version);
				const configDir = this.pathResolver.getGlobalConfigDir(safeHost);
				const configs = vscode.workspace.getConfiguration();
				const auth = resolveCliAuth(configs, featureSet, baseUrl, configDir);
				const globalFlags = getGlobalFlags(configs, auth);
				const workspaceName = createWorkspaceIdentifier(workspace);

				return cliUtils.speedtest(binary, globalFlags, workspaceName, {
					signal,
					duration: duration.trim(),
				});
			},
			{
				location: vscode.ProgressLocation.Notification,
				title: `Running ${duration.trim()} speed test...`,
				cancellable: true,
			},
		);

		if (result.ok) {
			const doc = await vscode.workspace.openTextDocument({
				content: result.value,
				language: "json",
			});
			await vscode.window.showTextDocument(doc);
			return;
		}

		if (result.cancelled) {
			return;
		}

		this.logger.error("Speed test failed", result.error);
		vscode.window.showErrorMessage(
			`Speed test failed: ${toError(result.error).message}`,
		);
	}

	/**
	 * View the logs for the currently connected workspace.
	 */
	public async viewLogs(): Promise<void> {
		if (this.workspaceLogPath) {
			// Return the connected deployment's log file.
			return openFile(this.workspaceLogPath);
		}

		const logDir = this.pathResolver.getProxyLogPath();
		try {
			const files = await readdirOrEmpty(logDir);
			// Sort explicitly since fs.readdir order is platform-dependent
			const logFiles = files
				.filter((f) => f.endsWith(".log"))
				.sort((a, b) => a.localeCompare(b))
				.reverse();

			if (logFiles.length === 0) {
				vscode.window.showInformationMessage(
					"No log files found in the log directory.",
				);
				return;
			}

			const selected = await vscode.window.showQuickPick(logFiles, {
				title: "Select a log file to view",
			});

			if (selected) {
				await openFile(path.join(logDir, selected));
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to read log directory: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Log out and clear stored credentials, requiring re-authentication on next login.
	 */
	public async logout(): Promise<void> {
		if (!this.deploymentManager.isAuthenticated()) {
			return;
		}

		this.logger.debug("Logging out");

		const deployment = this.deploymentManager.getCurrentDeployment();

		await this.deploymentManager.clearDeployment();

		if (deployment) {
			await this.cliManager.clearCredentials(deployment.url);
			await this.secretsManager.clearAllAuthData(deployment.safeHostname);
		}

		vscode.window
			.showInformationMessage("You've been logged out of Coder!", "Login")
			.then((action) => {
				if (action === "Login") {
					this.login().catch((error) => {
						this.logger.error("Login failed", error);
					});
				}
			});

		this.logger.debug("Logout complete");
	}

	/**
	 * Switch to a different deployment without clearing credentials.
	 * If login fails or user cancels, stays on current deployment.
	 */
	public async switchDeployment(): Promise<void> {
		this.logger.debug("Switching deployment");
		await this.performLogin();
	}

	/**
	 * Manage stored credentials for all deployments.
	 * Shows a list of deployments with options to remove individual or all credentials.
	 */
	public async manageCredentials(): Promise<void> {
		try {
			const hostnames = await this.secretsManager.getKnownSafeHostnames();
			if (hostnames.length === 0) {
				vscode.window.showInformationMessage("No stored credentials.");
				return;
			}

			const items: Array<{
				label: string;
				description: string;
				hostnames: string[];
			}> = hostnames.map((hostname) => ({
				label: `$(key) ${hostname}`,
				description: "Remove stored credentials",
				hostnames: [hostname],
			}));

			// Only show "Remove All" when there are multiple deployments
			if (hostnames.length > 1) {
				items.push({
					label: "$(trash) Remove All",
					description: `Remove credentials for all ${hostnames.length} deployments`,
					hostnames,
				});
			}

			const selected = await vscode.window.showQuickPick(items, {
				title: "Manage Stored Credentials",
				placeHolder: "Select a deployment to remove",
			});

			if (!selected) {
				return;
			}

			if (selected.hostnames.length === 1) {
				const selectedHostname = selected.hostnames[0];
				const auth = await this.secretsManager.getSessionAuth(selectedHostname);
				if (auth?.url) {
					await this.cliManager.clearCredentials(auth.url);
				}
				await this.secretsManager.clearAllAuthData(selectedHostname);
				this.logger.info("Removed credentials for", selectedHostname);
				vscode.window.showInformationMessage(
					`Removed credentials for ${selectedHostname}`,
				);
			} else {
				const confirm = await vscodeProposed.window.showWarningMessage(
					`Remove ${selected.hostnames.length} Credentials`,
					{
						useCustom: true,
						modal: true,
						detail: `This will remove credentials for: ${selected.hostnames.join(", ")}\n\nYou'll need to log in again to access them.`,
					},
					"Remove All",
				);
				if (confirm === "Remove All") {
					await Promise.all(
						selected.hostnames.map(async (h) => {
							const auth = await this.secretsManager.getSessionAuth(h);
							if (auth?.url) {
								await this.cliManager.clearCredentials(auth.url);
							}
							await this.secretsManager.clearAllAuthData(h);
						}),
					);
					this.logger.info(
						"Removed credentials for all deployments:",
						selected.hostnames.join(", "),
					);
					vscode.window.showInformationMessage(
						"Removed credentials for all deployments",
					);
				}
			}
		} catch (error: unknown) {
			this.logger.error("Failed to manage stored credentials", error);
			vscode.window.showErrorMessage(
				`Failed to manage stored credentials: ${toError(error).message}`,
			);
		}
	}

	/**
	 * Apply recommended SSH settings for reliable Coder workspace connections.
	 */
	public async applyRecommendedSettings(): Promise<void> {
		const entries = Object.entries(RECOMMENDED_SSH_SETTINGS);
		const summary = entries.map(([, s]) => s.label).join("\n");
		const confirm = await vscodeProposed.window.showWarningMessage(
			"Apply Recommended SSH Settings",
			{
				useCustom: true,
				modal: true,
				detail: summary,
			},
			"Apply",
		);
		if (confirm !== "Apply") {
			return;
		}

		const overrides = entries.map(([key, setting]) => ({
			key,
			value: setting.value,
		}));
		const ok = await applySettingOverrides(
			this.pathResolver.getUserSettingsPath(),
			overrides,
			this.logger,
		);
		if (!ok) {
			const action = await vscode.window.showErrorMessage(
				"Failed to write SSH settings. Check the Coder output for details.",
				"Show Output",
			);
			if (action === "Show Output") {
				this.logger.show();
			}
		} else if (this.remoteWorkspaceClient) {
			const action = await vscode.window.showInformationMessage(
				"Applied recommended SSH settings. Reload the window for changes to take effect.",
				"Reload Window",
			);
			if (action === "Reload Window") {
				await vscode.commands.executeCommand("workbench.action.reloadWindow");
			}
		} else {
			vscode.window.showInformationMessage("Applied recommended SSH settings.");
		}
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
	public async openFromSidebar(item: OpenableTreeItem): Promise<void> {
		if (item) {
			const baseUrl = this.extensionClient.getAxiosInstance().defaults.baseURL;
			if (!baseUrl) {
				throw new Error("You are not logged in");
			}
			if (item instanceof AgentTreeItem) {
				await this.openWorkspace(baseUrl, item.workspace, item.agent, {
					openRecent: true,
				});
			} else if (item instanceof WorkspaceTreeItem) {
				const agents = await this.extractAgentsWithFallback(item.workspace);
				const agent = await maybeAskAgent(agents);
				if (!agent) {
					// User declined to pick an agent.
					return;
				}
				await this.openWorkspace(baseUrl, item.workspace, agent, {
					openRecent: true,
				});
			} else {
				throw new TypeError("Unable to open unknown sidebar item");
			}
		} else {
			// If there is no tree item, then the user manually ran this command.
			// Default to the regular open instead.
			await this.open();
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
			return withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Connecting to AI Agent...`,
				},
				async () => {
					const { binary, globalFlags } = await this.resolveCliEnv(
						this.extensionClient,
					);

					const terminal = vscode.window.createTerminal(app.name);
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
	public async open(options: OpenOptions = {}): Promise<boolean> {
		const {
			workspaceOwner,
			workspaceName,
			agentName,
			folderPath,
			openRecent,
			useDefaultDirectory,
		} = { ...openDefaults, ...options };

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
				return false;
			}
		}

		const agents = await this.extractAgentsWithFallback(workspace);
		const agent = await maybeAskAgent(agents, agentName);
		if (!agent) {
			// User declined to pick an agent.
			return false;
		}

		return this.openWorkspace(baseUrl, workspace, agent, {
			folderPath,
			openRecent,
			useDefaultDirectory,
		});
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
		localWorkspaceFolder = "",
		localConfigFile = "",
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
		const action = await vscodeProposed.window.showWarningMessage(
			"Update Workspace",
			{
				useCustom: true,
				modal: true,
				detail: `Update ${createWorkspaceIdentifier(this.workspace)} to the latest version?\n\nUpdating will restart your workspace which stops any running processes and may result in the loss of unsaved work.`,
			},
			"Update and Restart",
		);
		if (action === "Update and Restart") {
			await this.remoteWorkspaceClient.updateWorkspaceVersion(this.workspace);
		}
	}

	public async pingWorkspace(item?: OpenableTreeItem): Promise<void> {
		let client: CoderApi;
		let workspaceId: string;

		if (item) {
			client = this.extensionClient;
			workspaceId = createWorkspaceIdentifier(item.workspace);
		} else if (this.workspace && this.remoteWorkspaceClient) {
			client = this.remoteWorkspaceClient;
			workspaceId = createWorkspaceIdentifier(this.workspace);
		} else {
			client = this.extensionClient;
			const workspace = await this.pickWorkspace({
				title: "Ping a running workspace",
				initialValue: "owner:me status:running ",
				placeholder: "Search running workspaces...",
				filter: (w) => w.latest_build.status === "running",
			});
			if (!workspace) {
				return;
			}
			workspaceId = createWorkspaceIdentifier(workspace);
		}

		return this.spawnPing(client, workspaceId);
	}

	private spawnPing(client: CoderApi, workspaceId: string): Thenable<void> {
		return withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Starting ping for ${workspaceId}...`,
			},
			async () => {
				const { binary, globalFlags } = await this.resolveCliEnv(client);

				const writeEmitter = new vscode.EventEmitter<string>();
				const closeEmitter = new vscode.EventEmitter<number | void>();

				const args = [...globalFlags, "ping", escapeCommandArg(workspaceId)];
				const cmd = `${escapeCommandArg(binary)} ${args.join(" ")}`;
				// On Unix, spawn in a new process group so we can signal the
				// entire group (shell + coder binary) on Ctrl+C. On Windows,
				// detached opens a visible console window and negative-PID kill
				// is unsupported, so we fall back to proc.kill().
				const useProcessGroup = process.platform !== "win32";
				const proc = spawn(cmd, {
					shell: true,
					detached: useProcessGroup,
				});

				let closed = false;
				let exited = false;
				let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

				const sendSignal = (sig: "SIGINT" | "SIGKILL") => {
					try {
						if (useProcessGroup && proc.pid) {
							process.kill(-proc.pid, sig);
						} else {
							proc.kill(sig);
						}
					} catch {
						// Process already exited.
					}
				};

				const gracefulKill = () => {
					sendSignal("SIGINT");
					// Escalate to SIGKILL if the process doesn't exit promptly.
					forceKillTimer = setTimeout(() => sendSignal("SIGKILL"), 5000);
				};

				const terminal = vscode.window.createTerminal({
					name: `Coder Ping: ${workspaceId}`,
					pty: {
						onDidWrite: writeEmitter.event,
						onDidClose: closeEmitter.event,
						open: () => {
							writeEmitter.fire("Press Ctrl+C (^C) to stop.\r\n");
							writeEmitter.fire("─".repeat(40) + "\r\n");
						},
						close: () => {
							closed = true;
							clearTimeout(forceKillTimer);
							sendSignal("SIGKILL");
							writeEmitter.dispose();
							closeEmitter.dispose();
						},
						handleInput: (data: string) => {
							if (exited) {
								closeEmitter.fire();
							} else if (data === "\x03") {
								if (forceKillTimer) {
									// Second Ctrl+C: force kill immediately.
									clearTimeout(forceKillTimer);
									sendSignal("SIGKILL");
								} else {
									if (!closed) {
										writeEmitter.fire("\r\nStopping...\r\n");
									}
									gracefulKill();
								}
							}
						},
					},
				});

				const fireLines = (data: Buffer) => {
					if (closed) {
						return;
					}
					const lines = data
						.toString()
						.split(/\r*\n/)
						.filter((line) => line !== "");
					for (const line of lines) {
						writeEmitter.fire(line + "\r\n");
					}
				};

				proc.stdout?.on("data", fireLines);
				proc.stderr?.on("data", fireLines);
				proc.on("error", (err) => {
					exited = true;
					clearTimeout(forceKillTimer);
					if (closed) {
						return;
					}
					writeEmitter.fire(`\r\nFailed to start: ${err.message}\r\n`);
					writeEmitter.fire("Press any key to close.\r\n");
				});
				proc.on("close", (code, signal) => {
					exited = true;
					clearTimeout(forceKillTimer);
					if (closed) {
						return;
					}
					let reason: string;
					if (signal === "SIGKILL") {
						reason = "Ping force killed (SIGKILL)";
					} else if (signal) {
						reason = "Ping stopped";
					} else {
						reason = `Process exited with code ${code}`;
					}
					writeEmitter.fire(`\r\n${reason}. Press any key to close.\r\n`);
				});

				terminal.show(false);
			},
		);
	}

	private async resolveCliEnv(
		client: CoderApi,
	): Promise<{ binary: string; globalFlags: string[] }> {
		const baseUrl = client.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("You are not logged in");
		}
		const safeHost = toSafeHost(baseUrl);
		const binary = await this.cliManager.fetchBinary(client);
		const version = semver.parse(await cliUtils.version(binary));
		const featureSet = featureSetForVersion(version);
		const configDir = this.pathResolver.getGlobalConfigDir(safeHost);
		const configs = vscode.workspace.getConfiguration();
		const auth = resolveCliAuth(configs, featureSet, baseUrl, configDir);
		const globalFlags = getGlobalShellFlags(configs, auth);
		return { binary, globalFlags };
	}

	/**
	 * Ask the user to select a workspace.  Return undefined if canceled.
	 */
	private async pickWorkspace(options?: {
		title?: string;
		initialValue?: string;
		placeholder?: string;
		filter?: (w: Workspace) => boolean;
	}): Promise<Workspace | undefined> {
		const quickPick = vscode.window.createQuickPick();
		quickPick.value = options?.initialValue ?? "owner:me ";
		quickPick.placeholder = options?.placeholder ?? "owner:me template:go";
		quickPick.title = options?.title ?? "Connect to a workspace";
		const filter = options?.filter;

		let lastWorkspaces: readonly Workspace[];
		const disposables: vscode.Disposable[] = [];
		disposables.push(
			quickPick.onDidChangeValue((value) => {
				quickPick.busy = true;
				this.extensionClient
					.getWorkspaces({
						q: value,
					})
					.then((workspaces) => {
						const filtered = filter
							? workspaces.workspaces.filter(filter)
							: workspaces.workspaces;
						lastWorkspaces = filtered;
						if (filtered.length === 0) {
							quickPick.items = [
								{
									label: "$(info) No matching workspaces found",
									alwaysShow: true,
								},
							];
						} else {
							quickPick.items = filtered.map((workspace) => {
								let icon = "$(debug-start)";
								if (workspace.latest_build.status !== "running") {
									icon = "$(debug-stop)";
								}
								const status = workspaceStatusLabel(
									workspace.latest_build.status,
								);
								return {
									alwaysShow: true,
									label: `${icon} ${workspace.owner_name} / ${workspace.name}`,
									detail: `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`,
								};
							});
						}
					})
					.catch((ex) => {
						this.logger.error("Failed to fetch workspaces", ex);
						if (ex instanceof CertificateError) {
							void ex.showNotification();
						} else {
							void vscode.window.showErrorMessage(
								`Failed to fetch workspaces: ${toError(ex).message}`,
							);
						}
					})
					.finally(() => {
						quickPick.busy = false;
					});
			}),
		);

		quickPick.show();
		return new Promise<Workspace | undefined>((resolve) => {
			disposables.push(
				quickPick.onDidHide(() => {
					resolve(undefined);
				}),
				quickPick.onDidChangeSelection((selected) => {
					if (selected.length < 1) {
						return resolve(undefined);
					}
					const workspace =
						lastWorkspaces[quickPick.items.indexOf(selected[0])];
					resolve(workspace);
				}),
			);
		}).finally(() => {
			for (const d of disposables) {
				d.dispose();
			}
			quickPick.dispose();
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
		options: Pick<
			OpenOptions,
			"folderPath" | "openRecent" | "useDefaultDirectory"
		> = {},
	): Promise<boolean> {
		const { openRecent, useDefaultDirectory } = {
			...openDefaults,
			...options,
		};
		let { folderPath } = options;
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

		if (!folderPath && useDefaultDirectory) {
			folderPath = agent.expanded_directory;
		}

		// If the agent had no folder or we have been asked to open the most recent,
		// we can try to open a recently opened folder/workspace.
		if (!folderPath || openRecent) {
			const output: {
				workspaces: Array<{ folderUri: vscode.Uri; remoteAuthority: string }>;
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
					return false;
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
			return true;
		}

		// This opens the workspace without an active folder opened.
		await vscode.commands.executeCommand("vscode.newWindow", {
			remoteAuthority: remoteAuthority,
			reuseWindow: !newWindow,
		});
		return true;
	}
}

async function openFile(filePath: string): Promise<void> {
	const uri = vscode.Uri.file(filePath);
	await vscode.window.showTextDocument(uri);
}

/**
 * Read a directory's entries, returning an empty array if it does not exist.
 */
async function readdirOrEmpty(dirPath: string): Promise<string[]> {
	try {
		return await fs.readdir(dirPath);
	} catch (err) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return [];
		}
		throw err;
	}
}
