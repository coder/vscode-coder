import { isAxiosError } from "axios";
import { type Api } from "coder/site/src/api/api";
import {
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import find from "find-process";
import * as fs from "fs/promises";
import * as jsonc from "jsonc-parser";
import * as os from "os";
import * as path from "path";
import prettyBytes from "pretty-bytes";
import * as semver from "semver";
import * as vscode from "vscode";

import {
	createAgentMetadataWatcher,
	getEventValue,
	formatEventLabel,
	formatMetadataError,
} from "../api/agentMetadataHelper";
import { createWorkspaceIdentifier, extractAgents } from "../api/api-helper";
import { CoderApi } from "../api/coderApi";
import { needToken } from "../api/utils";
import {
	startWorkspaceIfStoppedOrFailed,
	waitForBuild,
} from "../api/workspace";
import { type Commands } from "../commands";
import { type CliManager } from "../core/cliManager";
import * as cliUtils from "../core/cliUtils";
import { type ServiceContainer } from "../core/container";
import { type ContextManager } from "../core/contextManager";
import { type PathResolver } from "../core/pathResolver";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import { getGlobalFlags } from "../globalFlags";
import { Inbox } from "../inbox";
import { type Logger } from "../logging/logger";
import {
	AuthorityPrefix,
	escapeCommandArg,
	expandPath,
	findPort,
	parseRemoteAuthority,
} from "../util";
import { WorkspaceMonitor } from "../workspace/workspaceMonitor";

import { SSHConfig, type SSHValues, mergeSSHConfigValues } from "./sshConfig";
import { computeSSHProperties, sshSupportsSetEnv } from "./sshSupport";

export interface RemoteDetails extends vscode.Disposable {
	url: string;
	token: string;
}

export class Remote {
	// We use the proposed API to get access to useCustom in dialogs.
	private readonly vscodeProposed: typeof vscode;
	private readonly logger: Logger;
	private readonly pathResolver: PathResolver;
	private readonly cliManager: CliManager;
	private readonly contextManager: ContextManager;

	// Used to race between the login dialog and logging in from a different window
	private loginDetectedResolver: (() => void) | undefined;
	private loginDetectedRejector: ((reason?: Error) => void) | undefined;
	private loginDetectedPromise: Promise<void> = Promise.resolve();

	public constructor(
		serviceContainer: ServiceContainer,
		private readonly commands: Commands,
		private readonly mode: vscode.ExtensionMode,
	) {
		this.vscodeProposed = serviceContainer.getVsCodeProposed();
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.cliManager = serviceContainer.getCliManager();
		this.contextManager = serviceContainer.getContextManager();
	}

	/**
	 * Creates a new promise that will be resolved when login is detected in another window.
	 */
	private createLoginDetectionPromise(): void {
		if (this.loginDetectedRejector) {
			this.loginDetectedRejector(
				new Error("Login detection cancelled - new login attempt started"),
			);
		}
		this.loginDetectedPromise = new Promise<void>((resolve, reject) => {
			this.loginDetectedResolver = resolve;
			this.loginDetectedRejector = reject;
		});
	}

	/**
	 * Resolves the current login detection promise if one exists.
	 */
	public resolveLoginDetected(): void {
		if (this.loginDetectedResolver) {
			this.loginDetectedResolver();
			this.loginDetectedResolver = undefined;
			this.loginDetectedRejector = undefined;
		}
	}

	private async confirmStart(workspaceName: string): Promise<boolean> {
		const action = await this.vscodeProposed.window.showInformationMessage(
			`Unable to connect to the workspace ${workspaceName} because it is not running. Start the workspace?`,
			{
				useCustom: true,
				modal: true,
			},
			"Start",
		);
		return action === "Start";
	}

	/**
	 * Try to get the workspace running.  Return undefined if the user canceled.
	 */
	private async maybeWaitForRunning(
		client: CoderApi,
		workspace: Workspace,
		label: string,
		binPath: string,
		featureSet: FeatureSet,
		firstConnect: boolean,
	): Promise<Workspace | undefined> {
		const workspaceName = createWorkspaceIdentifier(workspace);

		// A terminal will be used to stream the build, if one is necessary.
		let writeEmitter: undefined | vscode.EventEmitter<string>;
		let terminal: undefined | vscode.Terminal;
		let attempts = 0;

		function initWriteEmitterAndTerminal(): vscode.EventEmitter<string> {
			writeEmitter ??= new vscode.EventEmitter<string>();
			if (!terminal) {
				terminal = vscode.window.createTerminal({
					name: "Build Log",
					location: vscode.TerminalLocation.Panel,
					// Spin makes this gear icon spin!
					iconPath: new vscode.ThemeIcon("gear~spin"),
					pty: {
						onDidWrite: writeEmitter.event,
						close: () => undefined,
						open: () => undefined,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} as Partial<vscode.Pseudoterminal> as any,
				});
				terminal.show(true);
			}
			return writeEmitter;
		}

		try {
			// Show a notification while we wait.
			return await this.vscodeProposed.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
					title: "Waiting for workspace build...",
				},
				async () => {
					const globalConfigDir = this.pathResolver.getGlobalConfigDir(label);
					while (workspace.latest_build.status !== "running") {
						++attempts;
						switch (workspace.latest_build.status) {
							case "pending":
							case "starting":
							case "stopping":
								writeEmitter = initWriteEmitterAndTerminal();
								this.logger.info(`Waiting for ${workspaceName}...`);
								workspace = await waitForBuild(client, writeEmitter, workspace);
								break;
							case "stopped":
								if (
									!firstConnect &&
									!(await this.confirmStart(workspaceName))
								) {
									return undefined;
								}
								writeEmitter = initWriteEmitterAndTerminal();
								this.logger.info(`Starting ${workspaceName}...`);
								workspace = await startWorkspaceIfStoppedOrFailed(
									client,
									globalConfigDir,
									binPath,
									workspace,
									writeEmitter,
									featureSet,
								);
								break;
							case "failed":
								// On a first attempt, we will try starting a failed workspace
								// (for example canceling a start seems to cause this state).
								if (attempts === 1) {
									if (
										!firstConnect &&
										!(await this.confirmStart(workspaceName))
									) {
										return undefined;
									}
									writeEmitter = initWriteEmitterAndTerminal();
									this.logger.info(`Starting ${workspaceName}...`);
									workspace = await startWorkspaceIfStoppedOrFailed(
										client,
										globalConfigDir,
										binPath,
										workspace,
										writeEmitter,
										featureSet,
									);
									break;
								}
							// Otherwise fall through and error.
							case "canceled":
							case "canceling":
							case "deleted":
							case "deleting":
							default: {
								const is =
									workspace.latest_build.status === "failed" ? "has" : "is";
								throw new Error(
									`${workspaceName} ${is} ${workspace.latest_build.status}`,
								);
							}
						}
						this.logger.info(
							`${workspaceName} status is now`,
							workspace.latest_build.status,
						);
					}
					return workspace;
				},
			);
		} finally {
			if (writeEmitter) {
				writeEmitter.dispose();
			}
			if (terminal) {
				terminal.dispose();
			}
		}
	}

	/**
	 * Ensure the workspace specified by the remote authority is ready to receive
	 * SSH connections.  Return undefined if the authority is not for a Coder
	 * workspace or when explicitly closing the remote.
	 */
	public async setup(
		remoteAuthority: string,
		firstConnect: boolean,
	): Promise<RemoteDetails | undefined> {
		const parts = parseRemoteAuthority(remoteAuthority);
		if (!parts) {
			// Not a Coder host.
			return;
		}

		const workspaceName = `${parts.username}/${parts.workspace}`;

		// Migrate "session_token" file to "session", if needed.
		await this.migrateSessionToken(parts.label);

		// Get the URL and token belonging to this host.
		const { url: baseUrlRaw, token } = await this.cliManager.readConfig(
			parts.label,
		);

		const showLoginDialog = async (message: string) => {
			this.createLoginDetectionPromise();
			const dialogPromise = this.vscodeProposed.window.showInformationMessage(
				message,
				{
					useCustom: true,
					modal: true,
					detail: `You must log in to access ${workspaceName}. If you've already logged in, you may close this dialog.`,
				},
				"Log In",
			);

			// Race between dialog and login detection
			const result = await Promise.race([
				this.loginDetectedPromise.then(() => ({ type: "login" as const })),
				dialogPromise.then((userChoice) => ({
					type: "dialog" as const,
					userChoice,
				})),
			]);

			if (result.type === "login") {
				return this.setup(remoteAuthority, firstConnect);
			} else if (!result.userChoice) {
				// User declined to log in.
				await this.closeRemote();
				return;
			} else {
				// Log in then try again.
				await this.commands.login({ url: baseUrlRaw, label: parts.label });
				return this.setup(remoteAuthority, firstConnect);
			}
		};

		// It could be that the cli config was deleted.  If so, ask for the url.
		if (
			!baseUrlRaw ||
			(!token && needToken(vscode.workspace.getConfiguration()))
		) {
			return showLoginDialog("You are not logged in...");
		}

		this.logger.info("Using deployment URL", baseUrlRaw);
		this.logger.info("Using deployment label", parts.label || "n/a");

		// We could use the plugin client, but it is possible for the user to log
		// out or log into a different deployment while still connected, which would
		// break this connection.  We could force close the remote session or
		// disallow logging out/in altogether, but for now just use a separate
		// client to remain unaffected by whatever the plugin is doing.
		const workspaceClient = CoderApi.create(baseUrlRaw, token, this.logger);
		// Store for use in commands.
		this.commands.workspaceRestClient = workspaceClient;

		let binaryPath: string | undefined;
		if (this.mode === vscode.ExtensionMode.Production) {
			binaryPath = await this.cliManager.fetchBinary(
				workspaceClient,
				parts.label,
			);
		} else {
			try {
				// In development, try to use `/tmp/coder` as the binary path.
				// This is useful for debugging with a custom bin!
				binaryPath = path.join(os.tmpdir(), "coder");
				await fs.stat(binaryPath);
			} catch {
				binaryPath = await this.cliManager.fetchBinary(
					workspaceClient,
					parts.label,
				);
			}
		}

		// First thing is to check the version.
		const buildInfo = await workspaceClient.getBuildInfo();

		let version: semver.SemVer | null = null;
		try {
			version = semver.parse(await cliUtils.version(binaryPath));
		} catch {
			version = semver.parse(buildInfo.version);
		}

		const featureSet = featureSetForVersion(version);

		// Server versions before v0.14.1 don't support the vscodessh command!
		if (!featureSet.vscodessh) {
			await this.vscodeProposed.window.showErrorMessage(
				"Incompatible Server",
				{
					detail:
						"Your Coder server is too old to support the Coder extension! Please upgrade to v0.14.1 or newer.",
					modal: true,
					useCustom: true,
				},
				"Close Remote",
			);
			await this.closeRemote();
			return;
		}

		// Next is to find the workspace from the URI scheme provided.
		let workspace: Workspace;
		try {
			this.logger.info(`Looking for workspace ${workspaceName}...`);
			workspace = await workspaceClient.getWorkspaceByOwnerAndName(
				parts.username,
				parts.workspace,
			);
			this.logger.info(
				`Found workspace ${workspaceName} with status`,
				workspace.latest_build.status,
			);
			this.commands.workspace = workspace;
		} catch (error) {
			if (!isAxiosError(error)) {
				throw error;
			}
			switch (error.response?.status) {
				case 404: {
					const result =
						await this.vscodeProposed.window.showInformationMessage(
							`That workspace doesn't exist!`,
							{
								modal: true,
								detail: `${workspaceName} cannot be found on ${baseUrlRaw}. Maybe it was deleted...`,
								useCustom: true,
							},
							"Open Workspace",
						);
					if (!result) {
						await this.closeRemote();
					}
					await vscode.commands.executeCommand("coder.open");
					return;
				}
				case 401: {
					return showLoginDialog("Your session expired...");
				}
				default:
					throw error;
			}
		}

		const disposables: vscode.Disposable[] = [];
		try {
			// Register before connection so the label still displays!
			let labelFormatterDisposable = this.registerLabelFormatter(
				remoteAuthority,
				workspace.owner_name,
				workspace.name,
			);
			disposables.push({
				dispose: () => labelFormatterDisposable.dispose(),
			});

			// If the workspace is not in a running state, try to get it running.
			if (workspace.latest_build.status !== "running") {
				const updatedWorkspace = await this.maybeWaitForRunning(
					workspaceClient,
					workspace,
					parts.label,
					binaryPath,
					featureSet,
					firstConnect,
				);
				if (!updatedWorkspace) {
					// User declined to start the workspace.
					await this.closeRemote();
					return;
				}
				workspace = updatedWorkspace;
			}
			this.commands.workspace = workspace;

			// Pick an agent.
			this.logger.info(`Finding agent for ${workspaceName}...`);
			const agents = extractAgents(workspace.latest_build.resources);
			const gotAgent = await this.commands.maybeAskAgent(agents, parts.agent);
			if (!gotAgent) {
				// User declined to pick an agent.
				await this.closeRemote();
				return;
			}
			let agent = gotAgent; // Reassign so it cannot be undefined in callbacks.
			this.logger.info(`Found agent ${agent.name} with status`, agent.status);

			// Do some janky setting manipulation.
			this.logger.info("Modifying settings...");
			const remotePlatforms = this.vscodeProposed.workspace
				.getConfiguration()
				.get<Record<string, string>>("remote.SSH.remotePlatform", {});
			const connTimeout = this.vscodeProposed.workspace
				.getConfiguration()
				.get<number | undefined>("remote.SSH.connectTimeout");

			// We have to directly munge the settings file with jsonc because trying to
			// update properly through the extension API hangs indefinitely.  Possibly
			// VS Code is trying to update configuration on the remote, which cannot
			// connect until we finish here leading to a deadlock.  We need to update it
			// locally, anyway, and it does not seem possible to force that via API.
			let settingsContent = "{}";
			try {
				settingsContent = await fs.readFile(
					this.pathResolver.getUserSettingsPath(),
					"utf8",
				);
			} catch {
				// Ignore! It's probably because the file doesn't exist.
			}

			// Add the remote platform for this host to bypass a step where VS Code asks
			// the user for the platform.
			let mungedPlatforms = false;
			if (
				!remotePlatforms[parts.host] ||
				remotePlatforms[parts.host] !== agent.operating_system
			) {
				remotePlatforms[parts.host] = agent.operating_system;
				settingsContent = jsonc.applyEdits(
					settingsContent,
					jsonc.modify(
						settingsContent,
						["remote.SSH.remotePlatform"],
						remotePlatforms,
						{},
					),
				);
				mungedPlatforms = true;
			}

			// VS Code ignores the connect timeout in the SSH config and uses a default
			// of 15 seconds, which can be too short in the case where we wait for
			// startup scripts.  For now we hardcode a longer value.  Because this is
			// potentially overwriting user configuration, it feels a bit sketchy.  If
			// microsoft/vscode-remote-release#8519 is resolved we can remove this.
			const minConnTimeout = 1800;
			let mungedConnTimeout = false;
			if (!connTimeout || connTimeout < minConnTimeout) {
				settingsContent = jsonc.applyEdits(
					settingsContent,
					jsonc.modify(
						settingsContent,
						["remote.SSH.connectTimeout"],
						minConnTimeout,
						{},
					),
				);
				mungedConnTimeout = true;
			}

			if (mungedPlatforms || mungedConnTimeout) {
				try {
					await fs.writeFile(
						this.pathResolver.getUserSettingsPath(),
						settingsContent,
					);
				} catch (ex) {
					// This could be because the user's settings.json is read-only.  This is
					// the case when using home-manager on NixOS, for example.  Failure to
					// write here is not necessarily catastrophic since the user will be
					// asked for the platform and the default timeout might be sufficient.
					mungedPlatforms = mungedConnTimeout = false;
					this.logger.warn("Failed to configure settings", ex);
				}
			}

			// Watch the workspace for changes.
			const monitor = await WorkspaceMonitor.create(
				workspace,
				workspaceClient,
				this.logger,
				this.vscodeProposed,
				this.contextManager,
			);
			disposables.push(monitor);
			disposables.push(
				monitor.onChange.event((w) => (this.commands.workspace = w)),
			);

			// Watch coder inbox for messages
			const inbox = await Inbox.create(workspace, workspaceClient, this.logger);
			disposables.push(inbox);

			// Wait for the agent to connect.
			if (agent.status === "connecting") {
				this.logger.info(`Waiting for ${workspaceName}/${agent.name}...`);
				await vscode.window.withProgress(
					{
						title: "Waiting for the agent to connect...",
						location: vscode.ProgressLocation.Notification,
					},
					async () => {
						await new Promise<void>((resolve) => {
							const updateEvent = monitor.onChange.event((workspace) => {
								if (!agent) {
									return;
								}
								const agents = extractAgents(workspace.latest_build.resources);
								const found = agents.find((newAgent) => {
									return newAgent.id === agent.id;
								});
								if (!found) {
									return;
								}
								agent = found;
								if (agent.status === "connecting") {
									return;
								}
								updateEvent.dispose();
								resolve();
							});
						});
					},
				);
				this.logger.info(`Agent ${agent.name} status is now`, agent.status);
			}

			// Make sure the agent is connected.
			// TODO: Should account for the lifecycle state as well?
			if (agent.status !== "connected") {
				const result = await this.vscodeProposed.window.showErrorMessage(
					`${workspaceName}/${agent.name} ${agent.status}`,
					{
						useCustom: true,
						modal: true,
						detail: `The ${agent.name} agent failed to connect. Try restarting your workspace.`,
					},
				);
				if (!result) {
					await this.closeRemote();
					return;
				}
				await this.reloadWindow();
				return;
			}

			const logDir = this.getLogDir(featureSet);

			// This ensures the Remote SSH extension resolves the host to execute the
			// Coder binary properly.
			//
			// If we didn't write to the SSH config file, connecting would fail with
			// "Host not found".
			try {
				this.logger.info("Updating SSH config...");
				await this.updateSSHConfig(
					workspaceClient,
					parts.label,
					parts.host,
					binaryPath,
					logDir,
					featureSet,
				);
			} catch (error) {
				this.logger.warn("Failed to configure SSH", error);
				throw error;
			}

			// TODO: This needs to be reworked; it fails to pick up reconnects.
			this.findSSHProcessID().then(async (pid) => {
				if (!pid) {
					// TODO: Show an error here!
					return;
				}
				disposables.push(this.showNetworkUpdates(pid));
				if (logDir) {
					const logFiles = await fs.readdir(logDir);
					const logFileName = logFiles
						.reverse()
						.find(
							(file) => file === `${pid}.log` || file.endsWith(`-${pid}.log`),
						);
					this.commands.workspaceLogPath = logFileName
						? path.join(logDir, logFileName)
						: undefined;
				} else {
					this.commands.workspaceLogPath = undefined;
				}
			});

			// Register the label formatter again because SSH overrides it!
			disposables.push(
				vscode.extensions.onDidChange(() => {
					// Dispose previous label formatter
					labelFormatterDisposable.dispose();
					labelFormatterDisposable = this.registerLabelFormatter(
						remoteAuthority,
						workspace.owner_name,
						workspace.name,
						agent.name,
					);
				}),
				...(await this.createAgentMetadataStatusBar(agent, workspaceClient)),
			);
		} catch (ex) {
			// Whatever error happens, make sure we clean up the disposables in case of failure
			disposables.forEach((d) => d.dispose());
			throw ex;
		}

		this.logger.info("Remote setup complete");

		// Returning the URL and token allows the plugin to authenticate its own
		// client, for example to display the list of workspaces belonging to this
		// deployment in the sidebar.  We use our own client in here for reasons
		// explained above.
		return {
			url: baseUrlRaw,
			token,
			dispose: () => {
				disposables.forEach((d) => d.dispose());
			},
		};
	}

	/**
	 * Migrate the session token file from "session_token" to "session", if needed.
	 */
	private async migrateSessionToken(label: string) {
		const oldTokenPath = this.pathResolver.getLegacySessionTokenPath(label);
		const newTokenPath = this.pathResolver.getSessionTokenPath(label);
		try {
			await fs.rename(oldTokenPath, newTokenPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
				return;
			}
			throw error;
		}
	}

	/**
	 * Return the --log-dir argument value for the ProxyCommand.  It may be an
	 * empty string if the setting is not set or the cli does not support it.
	 */
	private getLogDir(featureSet: FeatureSet): string {
		if (!featureSet.proxyLogDirectory) {
			return "";
		}
		// If the proxyLogDirectory is not set in the extension settings we don't send one.
		return expandPath(
			String(
				vscode.workspace.getConfiguration().get("coder.proxyLogDirectory") ??
					"",
			).trim(),
		);
	}

	/**
	 * Formats the --log-dir argument for the ProxyCommand after making sure it
	 * has been created.
	 */
	private async formatLogArg(logDir: string): Promise<string> {
		if (!logDir) {
			return "";
		}
		await fs.mkdir(logDir, { recursive: true });
		this.logger.info("SSH proxy diagnostics are being written to", logDir);
		return ` --log-dir ${escapeCommandArg(logDir)} -v`;
	}

	// updateSSHConfig updates the SSH configuration with a wildcard that handles
	// all Coder entries.
	private async updateSSHConfig(
		restClient: Api,
		label: string,
		hostName: string,
		binaryPath: string,
		logDir: string,
		featureSet: FeatureSet,
	) {
		let deploymentSSHConfig = {};
		try {
			const deploymentConfig = await restClient.getDeploymentSSHConfig();
			deploymentSSHConfig = deploymentConfig.ssh_config_options;
		} catch (error) {
			if (!isAxiosError(error)) {
				throw error;
			}
			switch (error.response?.status) {
				case 404: {
					// Deployment does not support overriding ssh config yet. Likely an
					// older version, just use the default.
					break;
				}
				case 401: {
					await this.vscodeProposed.window.showErrorMessage(
						"Your session expired...",
					);
					throw error;
				}
				default:
					throw error;
			}
		}

		// deploymentConfig is now set from the remote coderd deployment.
		// Now override with the user's config.
		const userConfigSSH =
			vscode.workspace.getConfiguration("coder").get<string[]>("sshConfig") ||
			[];
		// Parse the user's config into a Record<string, string>.
		const userConfig = userConfigSSH.reduce(
			(acc, line) => {
				let i = line.indexOf("=");
				if (i === -1) {
					i = line.indexOf(" ");
					if (i === -1) {
						// This line is malformed. The setting is incorrect, and does not match
						// the pattern regex in the settings schema.
						return acc;
					}
				}
				const key = line.slice(0, i);
				const value = line.slice(i + 1);
				acc[key] = value;
				return acc;
			},
			{} as Record<string, string>,
		);
		const sshConfigOverrides = mergeSSHConfigValues(
			deploymentSSHConfig,
			userConfig,
		);

		let sshConfigFile = vscode.workspace
			.getConfiguration()
			.get<string>("remote.SSH.configFile");
		if (!sshConfigFile) {
			sshConfigFile = path.join(os.homedir(), ".ssh", "config");
		}
		// VS Code Remote resolves ~ to the home directory.
		// This is required for the tilde to work on Windows.
		if (sshConfigFile.startsWith("~")) {
			sshConfigFile = path.join(os.homedir(), sshConfigFile.slice(1));
		}

		const sshConfig = new SSHConfig(sshConfigFile);
		await sshConfig.load();

		const hostPrefix = label
			? `${AuthorityPrefix}.${label}--`
			: `${AuthorityPrefix}--`;

		const globalConfigs = this.globalConfigs(label);

		const proxyCommand = featureSet.wildcardSSH
			? `${escapeCommandArg(binaryPath)}${globalConfigs} ssh --stdio --usage-app=vscode --disable-autostart --network-info-dir ${escapeCommandArg(this.pathResolver.getNetworkInfoPath())}${await this.formatLogArg(logDir)} --ssh-host-prefix ${hostPrefix} %h`
			: `${escapeCommandArg(binaryPath)}${globalConfigs} vscodessh --network-info-dir ${escapeCommandArg(
					this.pathResolver.getNetworkInfoPath(),
				)}${await this.formatLogArg(logDir)} --session-token-file ${escapeCommandArg(this.pathResolver.getSessionTokenPath(label))} --url-file ${escapeCommandArg(
					this.pathResolver.getUrlPath(label),
				)} %h`;

		const sshValues: SSHValues = {
			Host: hostPrefix + `*`,
			ProxyCommand: proxyCommand,
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
		};
		if (sshSupportsSetEnv()) {
			// This allows for tracking the number of extension
			// users connected to workspaces!
			sshValues.SetEnv = " CODER_SSH_SESSION_TYPE=vscode";
		}

		await sshConfig.update(label, sshValues, sshConfigOverrides);

		// A user can provide a "Host *" entry in their SSH config to add options
		// to all hosts. We need to ensure that the options we set are not
		// overridden by the user's config.
		const computedProperties = computeSSHProperties(
			hostName,
			sshConfig.getRaw(),
		);
		const keysToMatch: Array<keyof SSHValues> = [
			"ProxyCommand",
			"UserKnownHostsFile",
			"StrictHostKeyChecking",
		];
		for (const key of keysToMatch) {
			if (computedProperties[key] === sshValues[key]) {
				continue;
			}

			const result = await this.vscodeProposed.window.showErrorMessage(
				"Unexpected SSH Config Option",
				{
					useCustom: true,
					modal: true,
					detail: `Your SSH config is overriding the "${key}" property to "${computedProperties[key]}" when it expected "${sshValues[key]}" for the "${hostName}" host. Please fix this and try again!`,
				},
				"Reload Window",
			);
			if (result === "Reload Window") {
				await this.reloadWindow();
			}
			await this.closeRemote();
		}

		return sshConfig.getRaw();
	}

	private globalConfigs(label: string): string {
		const vscodeConfig = vscode.workspace.getConfiguration();
		const args = getGlobalFlags(
			vscodeConfig,
			this.pathResolver.getGlobalConfigDir(label),
		);
		return ` ${args.join(" ")}`;
	}

	// showNetworkUpdates finds the SSH process ID that is being used by this
	// workspace and reads the file being created by the Coder CLI.
	private showNetworkUpdates(sshPid: number): vscode.Disposable {
		const networkStatus = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			1000,
		);
		const networkInfoFile = path.join(
			this.pathResolver.getNetworkInfoPath(),
			`${sshPid}.json`,
		);

		const updateStatus = (network: {
			p2p: boolean;
			latency: number;
			preferred_derp: string;
			derp_latency: { [key: string]: number };
			upload_bytes_sec: number;
			download_bytes_sec: number;
			using_coder_connect: boolean;
		}) => {
			let statusText = "$(globe) ";

			// Coder Connect doesn't populate any other stats
			if (network.using_coder_connect) {
				networkStatus.text = statusText + "Coder Connect ";
				networkStatus.tooltip = "You're connected using Coder Connect.";
				networkStatus.show();
				return;
			}

			if (network.p2p) {
				statusText += "Direct ";
				networkStatus.tooltip = "You're connected peer-to-peer ✨.";
			} else {
				statusText += network.preferred_derp + " ";
				networkStatus.tooltip =
					"You're connected through a relay 🕵.\nWe'll switch over to peer-to-peer when available.";
			}
			networkStatus.tooltip +=
				"\n\nDownload ↓ " +
				prettyBytes(network.download_bytes_sec, {
					bits: true,
				}) +
				"/s • Upload ↑ " +
				prettyBytes(network.upload_bytes_sec, {
					bits: true,
				}) +
				"/s\n";

			if (!network.p2p) {
				const derpLatency = network.derp_latency[network.preferred_derp];

				networkStatus.tooltip += `You ↔ ${derpLatency.toFixed(2)}ms ↔ ${network.preferred_derp} ↔ ${(network.latency - derpLatency).toFixed(2)}ms ↔ Workspace`;

				let first = true;
				Object.keys(network.derp_latency).forEach((region) => {
					if (region === network.preferred_derp) {
						return;
					}
					if (first) {
						networkStatus.tooltip += `\n\nOther regions:`;
						first = false;
					}
					networkStatus.tooltip += `\n${region}: ${Math.round(network.derp_latency[region] * 100) / 100}ms`;
				});
			}

			statusText += "(" + network.latency.toFixed(2) + "ms)";
			networkStatus.text = statusText;
			networkStatus.show();
		};
		let disposed = false;
		const periodicRefresh = () => {
			if (disposed) {
				return;
			}
			fs.readFile(networkInfoFile, "utf8")
				.then((content) => {
					return JSON.parse(content);
				})
				.then((parsed) => {
					try {
						updateStatus(parsed);
					} catch {
						// Ignore
					}
				})
				.catch(() => {
					// TODO: Log a failure here!
				})
				.finally(() => {
					// This matches the write interval of `coder vscodessh`.
					setTimeout(periodicRefresh, 3000);
				});
		};
		periodicRefresh();

		return {
			dispose: () => {
				disposed = true;
				networkStatus.dispose();
			},
		};
	}

	// findSSHProcessID returns the currently active SSH process ID that is
	// powering the remote SSH connection.
	private async findSSHProcessID(timeout = 15000): Promise<number | undefined> {
		const search = async (logPath: string): Promise<number | undefined> => {
			// This searches for the socksPort that Remote SSH is connecting to. We do
			// this to find the SSH process that is powering this connection. That SSH
			// process will be logging network information periodically to a file.
			const text = await fs.readFile(logPath, "utf8");
			const port = findPort(text);
			if (!port) {
				return;
			}
			const processes = await find("port", port);
			if (processes.length < 1) {
				return;
			}
			const process = processes[0];
			return process.pid;
		};
		const start = Date.now();
		const loop = async (): Promise<number | undefined> => {
			if (Date.now() - start > timeout) {
				return undefined;
			}
			// Loop until we find the remote SSH log for this window.
			const filePath = await this.getRemoteSSHLogPath();
			if (!filePath) {
				return new Promise((resolve) => setTimeout(() => resolve(loop()), 500));
			}
			// Then we search the remote SSH log until we find the port.
			const result = await search(filePath);
			if (!result) {
				return new Promise((resolve) => setTimeout(() => resolve(loop()), 500));
			}
			return result;
		};
		return loop();
	}

	/**
	 * Returns the log path for the "Remote - SSH" output panel.  There is no VS
	 * Code API to get the contents of an output panel.  We use this to get the
	 * active port so we can display network information.
	 */
	private async getRemoteSSHLogPath(): Promise<string | undefined> {
		const upperDir = path.dirname(this.pathResolver.getCodeLogDir());
		// Node returns these directories sorted already!
		const dirs = await fs.readdir(upperDir);
		const latestOutput = dirs
			.reverse()
			.filter((dir) => dir.startsWith("output_logging_"));
		if (latestOutput.length === 0) {
			return undefined;
		}
		const dir = await fs.readdir(path.join(upperDir, latestOutput[0]));
		const remoteSSH = dir.filter((file) => file.indexOf("Remote - SSH") !== -1);
		if (remoteSSH.length === 0) {
			return undefined;
		}
		return path.join(upperDir, latestOutput[0], remoteSSH[0]);
	}

	/**
	 * Creates and manages a status bar item that displays metadata information for a given workspace agent.
	 * The status bar item updates dynamically based on changes to the agent's metadata,
	 * and hides itself if no metadata is available or an error occurs.
	 */
	private async createAgentMetadataStatusBar(
		agent: WorkspaceAgent,
		client: CoderApi,
	): Promise<vscode.Disposable[]> {
		const statusBarItem = vscode.window.createStatusBarItem(
			"agentMetadata",
			vscode.StatusBarAlignment.Left,
		);

		const agentWatcher = await createAgentMetadataWatcher(agent.id, client);

		const onChangeDisposable = agentWatcher.onChange(() => {
			if (agentWatcher.error) {
				const errMessage = formatMetadataError(agentWatcher.error);
				this.logger.warn(errMessage);

				statusBarItem.text = "$(warning) Agent Status Unavailable";
				statusBarItem.tooltip = errMessage;
				statusBarItem.color = new vscode.ThemeColor(
					"statusBarItem.warningForeground",
				);
				statusBarItem.backgroundColor = new vscode.ThemeColor(
					"statusBarItem.warningBackground",
				);
				statusBarItem.show();
				return;
			}

			if (agentWatcher.metadata && agentWatcher.metadata.length > 0) {
				statusBarItem.text =
					"$(dashboard) " + getEventValue(agentWatcher.metadata[0]);
				statusBarItem.tooltip = agentWatcher.metadata
					.map((metadata) => formatEventLabel(metadata))
					.join("\n");
				statusBarItem.color = undefined;
				statusBarItem.backgroundColor = undefined;
				statusBarItem.show();
			} else {
				statusBarItem.hide();
			}
		});

		return [statusBarItem, agentWatcher, onChangeDisposable];
	}

	// closeRemote ends the current remote session.
	public async closeRemote() {
		await vscode.commands.executeCommand("workbench.action.remote.close");
	}

	// reloadWindow reloads the current window.
	public async reloadWindow() {
		await vscode.commands.executeCommand("workbench.action.reloadWindow");
	}

	private registerLabelFormatter(
		remoteAuthority: string,
		owner: string,
		workspace: string,
		agent?: string,
	): vscode.Disposable {
		// VS Code splits based on the separator when displaying the label
		// in a recently opened dialog. If the workspace suffix contains /,
		// then it'll visually display weird:
		// "/home/kyle [Coder: kyle/workspace]" displays as "workspace] /home/kyle [Coder: kyle"
		// For this reason, we use a different / that visually appears the
		// same on non-monospace fonts "∕".
		let suffix = `Coder: ${owner}∕${workspace}`;
		if (agent) {
			suffix += `∕${agent}`;
		}
		// VS Code caches resource label formatters in it's global storage SQLite database
		// under the key "memento/cachedResourceLabelFormatters2".
		return this.vscodeProposed.workspace.registerResourceLabelFormatter({
			scheme: "vscode-remote",
			// authority is optional but VS Code prefers formatters that most
			// accurately match the requested authority, so we include it.
			authority: remoteAuthority,
			formatting: {
				label: "${path}",
				separator: "/",
				tildify: true,
				workspaceSuffix: suffix,
			},
		});
	}
}
