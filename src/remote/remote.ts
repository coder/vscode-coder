import { isAxiosError } from "axios";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as semver from "semver";
import * as vscode from "vscode";

import {
	createAgentMetadataWatcher,
	getEventValue,
	formatEventLabel,
	formatMetadataError,
} from "../api/agentMetadataHelper";
import { extractAgents } from "../api/api-helper";
import { AuthInterceptor } from "../api/authInterceptor";
import { CoderApi } from "../api/coderApi";
import { needToken } from "../api/utils";
import {
	CONFIG_CHANGE_DEBOUNCE_MS,
	watchConfigurationChanges,
} from "../configWatcher";
import { version as cliVersion } from "../core/cliExec";
import { toError } from "../error/errorUtils";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import { Inbox } from "../inbox";
import { AuthTelemetry } from "../instrumentation/auth";
import {
	RemoteSetupTelemetry,
	type RemoteSetupTracer,
} from "../instrumentation/remoteSetup";
import { OAuthSessionManager } from "../oauth/sessionManager";
import {
	type CliAuth,
	getExpandedUserGlobalFlags,
	getGlobalShellFlags,
	getSshFlags,
	resolveCliAuth,
} from "../settings/cli";
import { getHeaderCommand } from "../settings/headers";
import { escapeCommandArg, expandPath } from "../util";
import {
	type AuthorityParts,
	classifyRemoteAuthority,
	parseRemoteAuthority,
	retargetRemoteAuthority,
	toCurrentAuthorityHostPrefix,
} from "../util/authority";
import { createStatusBarItem } from "../util/statusBar";
import { vscodeProposed } from "../vscodeProposed";
import { WorkspaceMonitor } from "../workspace/workspaceMonitor";

import { applySshEnvironment, SSH_PROXY_SETTINGS } from "./environment";
import { migrateAuthToSecretsStorage } from "./migration";
import {
	SshConfig,
	type SshValues,
	mergeSshConfigValues,
	parseCoderSshOptions,
	parseSshConfig,
	validateDeploymentSshOptions,
} from "./sshConfig";
import { getRemoteSshConfigFile } from "./sshExtension";
import { applySettingOverrides, buildSshOverrides } from "./sshOverrides";
import { SshProcessMonitor } from "./sshProcess";
import {
	computeSshProperties,
	sshSupportsSetEnv,
	type SshProperties,
} from "./sshSupport";
import { WorkspaceStateMachine } from "./workspaceStateMachine";

import type { Api } from "coder/site/src/api/api";
import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { Commands } from "../commands";
import type { CliManager } from "../core/cliManager";
import type { ServiceContainer } from "../core/container";
import type { ContextManager } from "../core/contextManager";
import type { StartupMode } from "../core/mementoManager";
import type { PathResolver } from "../core/pathResolver";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";
import type { LoginCoordinator } from "../login/loginCoordinator";

export interface RemoteDetails extends vscode.Disposable {
	safeHostname: string;
	url: string;
	token: string;
}

/** Original {@link Remote.setup} args; retained so auth retries can re-invoke. */
interface RemoteSetupArgs {
	remoteAuthority: string;
	startupMode: StartupMode;
	remoteSshExtensionId: string;
}

/** Per-attempt state for the remote setup flow, threaded through helpers. */
interface RemoteSetupContext {
	args: RemoteSetupArgs;
	parts: AuthorityParts;
	workspaceName: string;
	baseUrl: string;
	token: string | undefined;
	disposables: vscode.Disposable[];
}

export class Remote {
	private readonly logger: Logger;
	private readonly pathResolver: PathResolver;
	private readonly cliManager: CliManager;
	private readonly contextManager: ContextManager;
	private readonly secretsManager: SecretsManager;
	private readonly loginCoordinator: LoginCoordinator;
	private readonly setupTelemetry: RemoteSetupTelemetry;
	private readonly authTelemetry: AuthTelemetry;

	public constructor(
		private readonly serviceContainer: ServiceContainer,
		private readonly commands: Commands,
		private readonly extensionContext: vscode.ExtensionContext,
	) {
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.cliManager = serviceContainer.getCliManager();
		this.contextManager = serviceContainer.getContextManager();
		this.secretsManager = serviceContainer.getSecretsManager();
		this.loginCoordinator = serviceContainer.getLoginCoordinator();
		this.setupTelemetry = new RemoteSetupTelemetry(
			serviceContainer.getTelemetryService(),
		);
		this.authTelemetry = new AuthTelemetry(
			serviceContainer.getTelemetryService(),
		);
	}

	/**
	 * Ensure the workspace specified by the remote authority is ready to receive
	 * SSH connections.  Return undefined if the authority is not for a Coder
	 * workspace or when explicitly closing the remote.
	 */
	public async setup(
		remoteAuthority: string,
		startupMode: StartupMode,
		remoteSshExtensionId: string,
	): Promise<RemoteDetails | undefined> {
		let parts: AuthorityParts | null;
		try {
			parts = parseRemoteAuthority(remoteAuthority);
		} catch (error) {
			this.logger.warn("Failed to parse remote authority", {
				remoteAuthority,
				error: toError(error).message,
			});
			throw error;
		}
		if (!parts) {
			return;
		}

		switch (classifyRemoteAuthority(parts)) {
			case "current":
				break;
			case "legacy":
				await this.migrateLegacyAuthority(remoteAuthority, startupMode);
				return;
			case "foreign":
				return;
		}

		this.logger.info("Setting up remote connection", {
			remoteAuthority,
			hostname: parts.safeHostname,
			workspace: `${parts.username}/${parts.workspace}`,
			agent: parts.agent || "(default)",
		});

		// Both run before `remote.setup` so an auth-required retry doesn't nest
		// traces, and migration is kept out of `auth.session_lookup` so a slow
		// first-run migration doesn't pollute that signal.
		await migrateAuthToSecretsStorage(
			parts.safeHostname,
			this.pathResolver,
			this.secretsManager,
			this.logger,
		);
		const telemetry = this.serviceContainer.getTelemetryService();
		const auth = await this.authTelemetry.traceSessionLookup(() =>
			this.secretsManager.getSessionAuth(parts.safeHostname),
		);
		if (auth?.url) {
			telemetry.setDeploymentUrl(auth.url);
		}
		this.logger.debug("Retrieved auth for hostname", {
			hostname: parts.safeHostname,
			hasUrl: Boolean(auth?.url),
			hasToken: auth?.token !== undefined,
		});

		const args: RemoteSetupArgs = {
			remoteAuthority,
			startupMode,
			remoteSshExtensionId,
		};
		const workspaceName = `${parts.username}/${parts.workspace}`;
		const context: RemoteSetupContext = {
			args,
			parts,
			workspaceName,
			baseUrl: auth?.url ?? "",
			token: auth?.token,
			disposables: [],
		};

		if (
			!context.baseUrl ||
			(!context.token && needToken(vscode.workspace.getConfiguration()))
		) {
			return this.ensureLoggedInAndRetry(
				context,
				"You are not logged in...",
				context.baseUrl,
			);
		}

		return this.setupTelemetry.trace((tracer) =>
			this.setupCoderRemote(context, tracer),
		);
	}

	private async setupCoderRemote(
		context: RemoteSetupContext,
		tracer: RemoteSetupTracer,
	): Promise<RemoteDetails | undefined> {
		const { args, parts, workspaceName, baseUrl, token, disposables } = context;

		try {
			disposables.push(
				applySshEnvironment(
					vscode.workspace.getConfiguration(),
					this.extensionContext.environmentVariableCollection,
				),
			);
			// Create OAuth session manager for this remote deployment
			const remoteOAuthManager = OAuthSessionManager.create(
				{ url: baseUrl, safeHostname: parts.safeHostname },
				this.serviceContainer,
				async () => {
					await this.showSessionExpiredDialog(context);
				},
			);
			disposables.push(remoteOAuthManager);

			this.logger.info("Using deployment URL", baseUrl);
			this.logger.info("Using hostname", parts.safeHostname || "n/a");

			// We could use the plugin client, but it is possible for the user to log
			// out or log into a different deployment while still connected, which would
			// break this connection.  We could force close the remote session or
			// disallow logging out/in altogether, but for now just use a separate
			// client to remain unaffected by whatever the plugin is doing.
			const workspaceClient = CoderApi.create(
				baseUrl,
				token,
				this.logger,
				this.serviceContainer.getTelemetryService(),
			);
			disposables.push(workspaceClient);

			// Create 401 interceptor - handles auth failures with re-login dialog
			const authInterceptor = new AuthInterceptor(
				workspaceClient,
				remoteOAuthManager,
				this.serviceContainer,
				async () => {
					const result = await this.showSessionExpiredDialog(context);
					return result.success;
				},
			);
			disposables.push(authInterceptor);

			// Store for use in commands.
			this.commands.remoteWorkspaceClient = workspaceClient;

			const binaryPath = await tracer.phase("cli_resolve", () =>
				this.resolveRemoteBinary(workspaceClient),
			);

			const { featureSet, cliAuth } = await tracer.phase(
				"compatibility_check",
				() =>
					this.checkCompatibility({
						workspaceClient,
						binaryPath,
						baseUrl,
						safeHostname: parts.safeHostname,
					}),
			);

			// Reject deployments below our minimum supported version (v0.25.0)
			// before configuring credentials, so they get a clear message.
			if (!featureSet.cliLogin) {
				tracer.markAborted("incompatible_server");
				await vscodeProposed.window.showErrorMessage(
					"Incompatible Server",
					{
						detail:
							"Your Coder server is too old to support the Coder extension! Please upgrade to v0.25.0 or newer.",
						modal: true,
						useCustom: true,
					},
					"Close Remote",
				);
				disposables.forEach((d) => {
					d.dispose();
				});
				await this.closeRemote();
				return;
			}

			// Write token to keyring or file
			if (baseUrl && token !== undefined) {
				await tracer.phase("cli_configure", () =>
					this.cliManager.configure(baseUrl, token),
				);
			}

			// Listen for token changes for this deployment
			disposables.push(this.watchRemoteSessionAuth(context, workspaceClient));

			// Next is to find the workspace from the URI scheme provided.
			const foundWorkspace = await tracer.phase("workspace_lookup", () =>
				this.lookupWorkspace(context, workspaceClient),
			);
			if (!foundWorkspace) {
				tracer.markAborted("workspace_not_found");
				return;
			}
			let workspace: Workspace = foundWorkspace;

			// Register before connection so the label still displays!
			let labelFormatterDisposable = this.registerLabelFormatter(
				args.remoteAuthority,
				workspace.owner_name,
				workspace.name,
			);
			disposables.push({
				dispose: () => {
					labelFormatterDisposable.dispose();
				},
			});

			// Watch the workspace for changes.
			const monitor = await tracer.phase("workspace_monitor_setup", () =>
				WorkspaceMonitor.create(
					workspace,
					workspaceClient,
					this.serviceContainer,
				),
			);
			disposables.push(
				monitor,
				monitor.onChange.event((w) => (this.commands.workspace = w)),
			);

			// Wait for workspace to be running and agent to be ready
			this.logger.debug("Starting workspace state machine", {
				workspace: workspaceName,
				initialStatus: workspace.latest_build.status,
			});
			const stateMachine = new WorkspaceStateMachine(
				parts,
				workspaceClient,
				args.startupMode,
				binaryPath,
				featureSet,
				cliAuth,
				this.serviceContainer,
			);
			disposables.push(stateMachine);

			try {
				workspace = await tracer.phase("workspace_ready", () =>
					this.waitForWorkspaceReady(workspace, monitor, stateMachine),
				);
			} finally {
				stateMachine.dispose();
			}

			// Mark initial setup as complete so the monitor can start notifying about state changes
			monitor.markInitialSetupComplete();

			const agent = await tracer.phase("agent_resolve", () =>
				this.resolveAgent(context, workspace, stateMachine),
			);

			// Watch coder inbox for messages
			const inbox = await Inbox.create(workspace, workspaceClient, this.logger);
			disposables.push(inbox);

			const logDir = this.getLogDir(featureSet);

			const computedSshProperties = await tracer.phase("ssh_config_write", () =>
				this.writeRemoteSshConfig(
					context,
					workspaceClient,
					binaryPath,
					logDir,
					featureSet,
					cliAuth,
				),
			);
			const remoteCommand = computedSshProperties.remotecommand;

			this.logger.info("Modifying settings...");
			const overrides = buildSshOverrides(
				vscodeProposed.workspace.getConfiguration(),
				parts.sshHost,
				agent.operating_system,
				remoteCommand,
				this.logger,
			);
			if (overrides.length > 0) {
				const ok = await applySettingOverrides(
					this.pathResolver.getUserSettingsPath(),
					overrides,
					this.logger,
				);
				if (ok) {
					this.logger.info("Settings modified successfully");
				}
			}

			// Monitor SSH process and display network status
			const sshMonitor = await tracer.phase("ssh_monitor_setup", () =>
				SshProcessMonitor.start({
					sshHost: parts.sshHost,
					networkInfoPath: this.pathResolver.getNetworkInfoPath(),
					proxyLogDir: logDir || undefined,
					logger: this.logger,
					codeLogDir: this.pathResolver.getCodeLogDir(),
					remoteSshExtensionId: args.remoteSshExtensionId,
					telemetry: this.serviceContainer.getTelemetryService(),
				}),
			);
			disposables.push(sshMonitor);

			this.commands.workspaceLogPath = sshMonitor.getLogFilePath();

			const reregisterLabelFormatter = () => {
				labelFormatterDisposable.dispose();
				labelFormatterDisposable = this.registerLabelFormatter(
					args.remoteAuthority,
					workspace.owner_name,
					workspace.name,
					agent.name,
				);
			};

			disposables.push(
				sshMonitor.onLogFilePathChange((newPath) => {
					this.commands.workspaceLogPath = newPath;
				}),
				// Re-register label formatter when SSH process reconnects after sleep/wake
				sshMonitor.onPidChange(() => {
					reregisterLabelFormatter();
				}),
				// Register the label formatter again because SSH overrides it!
				vscode.extensions.onDidChange(() => {
					reregisterLabelFormatter();
				}),
				...(await this.createAgentMetadataStatusBar(agent, workspaceClient)),
			);

			const settingsToWatch: Array<{
				setting: string;
				title: string;
				getValue: () => unknown;
			}> = [
				{
					setting: "coder.globalFlags",
					title: "Global Flags",
					getValue: () =>
						getExpandedUserGlobalFlags(vscode.workspace.getConfiguration()),
				},
				{
					setting: "coder.headerCommand",
					title: "Header Command",
					getValue: () =>
						getHeaderCommand(vscode.workspace.getConfiguration()) ?? "",
				},
				{
					setting: "coder.sshFlags",
					title: "SSH Flags",
					getValue: () => getSshFlags(vscode.workspace.getConfiguration()),
				},
				...SSH_PROXY_SETTINGS.map(({ setting, title }) => ({
					setting,
					title,
					getValue: () => vscode.workspace.getConfiguration().get(setting),
				})),
			];
			if (featureSet.proxyLogDirectory) {
				settingsToWatch.push({
					setting: "coder.proxyLogDirectory",
					title: "Proxy Log Directory",
					getValue: () => this.getLogDir(featureSet),
				});
			}
			disposables.push(this.watchSettings(settingsToWatch));
		} catch (ex) {
			// Whatever error happens, make sure we clean up the disposables in case of failure
			disposables.forEach((d) => {
				d.dispose();
			});
			throw ex;
		}

		return await tracer.phase("connection_handoff", () => {
			this.contextManager.set("coder.workspace.connected", true);
			this.logger.info("Remote setup complete");

			// Returning the URL and token allows the plugin to authenticate its own
			// client, for example to display the list of workspaces belonging to this
			// deployment in the sidebar.  We use our own client in here for reasons
			// explained above.
			return {
				safeHostname: parts.safeHostname,
				url: baseUrl,
				token: token ?? "",
				dispose: () => {
					disposables.forEach((d) => {
						d.dispose();
					});
				},
			};
		});
	}

	private async lookupWorkspace(
		context: RemoteSetupContext,
		workspaceClient: CoderApi,
	): Promise<Workspace | undefined> {
		try {
			this.logger.info(`Looking for workspace ${context.workspaceName}...`);
			const workspace = await workspaceClient.getWorkspaceByOwnerAndName(
				context.parts.username,
				context.parts.workspace,
			);
			this.logger.info(
				`Found workspace ${context.workspaceName} with status`,
				workspace.latest_build.status,
			);
			this.commands.workspace = workspace;
			return workspace;
		} catch (error) {
			if (!isAxiosError(error)) {
				throw error;
			}
			switch (error.response?.status) {
				case 404: {
					const result = await vscodeProposed.window.showInformationMessage(
						`That workspace doesn't exist!`,
						{
							modal: true,
							detail: `${context.workspaceName} cannot be found on ${context.baseUrl}. Maybe it was deleted...`,
							useCustom: true,
						},
						"Open Workspace",
					);
					context.disposables.forEach((d) => {
						d.dispose();
					});
					if (!result) {
						await this.closeRemote();
					}
					await vscode.commands.executeCommand("coder.open");
					return undefined;
				}
				default:
					throw error;
			}
		}
	}

	private async waitForWorkspaceReady(
		workspace: Workspace,
		monitor: WorkspaceMonitor,
		stateMachine: WorkspaceStateMachine,
	): Promise<Workspace> {
		return vscodeProposed.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				cancellable: false,
				title: "Connecting to workspace",
			},
			async (progress) => {
				let inProgress = false;
				let pendingWorkspace: Workspace | null = null;

				return new Promise<Workspace>((resolve, reject) => {
					const processWorkspace = async (w: Workspace) => {
						if (inProgress) {
							// Process one workspace at a time, keeping only the last
							pendingWorkspace = w;
							return;
						}

						inProgress = true;
						try {
							pendingWorkspace = null;

							const isReady = await stateMachine.processWorkspace(w, progress);
							if (isReady) {
								subscription.dispose();
								resolve(stateMachine.getWorkspace() ?? w);
								return;
							}
						} catch (error: unknown) {
							subscription.dispose();
							reject(toError(error));
							return;
						} finally {
							inProgress = false;
						}

						if (pendingWorkspace) {
							void processWorkspace(pendingWorkspace);
						}
					};

					void processWorkspace(workspace);
					const subscription = monitor.onChange.event((w) => {
						void processWorkspace(w);
					});
				});
			},
		);
	}

	private resolveAgent(
		context: RemoteSetupContext,
		workspace: Workspace,
		stateMachine: WorkspaceStateMachine,
	): WorkspaceAgent {
		const agents = extractAgents(workspace.latest_build.resources);
		const agent = agents.find(
			(agent) => agent.id === stateMachine.getAgentId(),
		);

		if (!agent) {
			throw new Error("Failed to get workspace or agent from state machine");
		}

		this.logger.info("Workspace ready", {
			workspace: context.workspaceName,
			agent: agent.name,
			status: workspace.latest_build.status,
		});

		this.commands.workspace = workspace;
		this.commands.agent = agent;
		return agent;
	}

	private async writeRemoteSshConfig(
		context: RemoteSetupContext,
		workspaceClient: Api,
		binaryPath: string,
		logDir: string,
		featureSet: FeatureSet,
		cliAuth: CliAuth,
	): Promise<SshProperties> {
		try {
			this.logger.info("Updating SSH config...");
			return await this.updateSSHConfig(
				workspaceClient,
				context.parts.safeHostname,
				context.parts.sshHost,
				binaryPath,
				logDir,
				featureSet,
				cliAuth,
			);
		} catch (error) {
			this.logger.warn("Failed to configure SSH", error);
			throw error;
		}
	}

	private showSessionExpiredDialog(context: RemoteSetupContext) {
		return this.loginCoordinator.ensureLoggedInWithDialog({
			safeHostname: context.parts.safeHostname,
			url: context.baseUrl,
			message: "Your session expired...",
			detailPrefix: `You must log in to access ${context.workspaceName}.`,
			trigger: "auth_required",
		});
	}

	private async ensureLoggedInAndRetry(
		context: RemoteSetupContext,
		message: string,
		url: string | undefined,
	): Promise<RemoteDetails | undefined> {
		const result = await this.loginCoordinator.ensureLoggedInWithDialog({
			safeHostname: context.parts.safeHostname,
			url,
			message,
			detailPrefix: `You must log in to access ${context.workspaceName}.`,
			trigger: "missing_session",
		});

		// Dispose before retrying since setup will create new disposables.
		context.disposables.forEach((d) => {
			d.dispose();
		});
		if (result.success) {
			const { remoteAuthority, startupMode, remoteSshExtensionId } =
				context.args;
			return this.setup(remoteAuthority, startupMode, remoteSshExtensionId);
		}

		// User cancelled or login failed
		await this.closeRemote();
		return undefined;
	}

	private async migrateLegacyAuthority(
		remoteAuthority: string,
		startupMode: StartupMode,
	): Promise<void> {
		const migratedAuthority = retargetRemoteAuthority(remoteAuthority);
		const workspaceFile = vscode.workspace.workspaceFile;
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		const savedWorkspaceFile =
			workspaceFile?.scheme === "untitled" ? undefined : workspaceFile;
		if (!savedWorkspaceFile && workspaceFolders.length > 1) {
			this.logger.warn(
				"Cannot migrate an unsaved multi-root workspace",
				remoteAuthority,
			);
			const choice = await vscodeProposed.window.showWarningMessage(
				"Opening the remote over the old coder-vscode SSH host",
				{
					modal: true,
					useCustom: true,
					detail:
						"This editor now uses its own SSH hosts, but switching an unsaved multi-root workspace would drop its folders. " +
						"To switch, save the workspace, then reload the window.",
				},
				"Learn More",
			);
			if (choice === "Learn More") {
				await vscode.env.openExternal(
					vscode.Uri.parse(
						"https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces",
					),
				);
			}
			return;
		}

		await this.serviceContainer
			.getMementoManager()
			.setStartupMode(startupMode === "none" ? "start" : startupMode);
		this.logger.info("Migrating legacy remote authority", {
			from: remoteAuthority,
			to: migratedAuthority,
		});

		const currentUri = savedWorkspaceFile ?? workspaceFolders[0]?.uri;
		if (currentUri) {
			await vscode.commands.executeCommand(
				"vscode.openFolder",
				currentUri.with({
					authority: retargetRemoteAuthority(currentUri.authority),
				}),
				false,
			);
			return;
		}
		await vscode.commands.executeCommand("vscode.newWindow", {
			remoteAuthority: migratedAuthority,
			reuseWindow: true,
		});
	}

	private async resolveRemoteBinary(workspaceClient: Api): Promise<string> {
		if (
			this.extensionContext.extensionMode === vscode.ExtensionMode.Production
		) {
			return this.cliManager.fetchBinary(workspaceClient);
		}
		// Dev override: use a custom binary at /tmp/coder if it exists.
		try {
			const binaryPath = path.join(os.tmpdir(), "coder");
			await fs.stat(binaryPath);
			return binaryPath;
		} catch {
			return this.cliManager.fetchBinary(workspaceClient);
		}
	}

	/**
	 * Resolve the feature set and CLI auth, falling back to the server version
	 * when the CLI version can't be read.
	 */
	private async checkCompatibility(options: {
		workspaceClient: Api;
		binaryPath: string;
		baseUrl: string;
		safeHostname: string;
	}): Promise<{ featureSet: FeatureSet; cliAuth: CliAuth }> {
		const { workspaceClient, binaryPath, baseUrl, safeHostname } = options;
		const buildInfo = await workspaceClient.getBuildInfo();

		let version: semver.SemVer | null;
		try {
			version = semver.parse(await cliVersion(binaryPath));
		} catch {
			version = semver.parse(buildInfo.version);
		}

		const featureSet = featureSetForVersion(version);
		const configDir = this.pathResolver.getGlobalConfigDir(safeHostname);
		const cliAuth = resolveCliAuth(
			vscode.workspace.getConfiguration(),
			featureSet,
			baseUrl,
			configDir,
		);
		return { featureSet, cliAuth };
	}

	private watchRemoteSessionAuth(
		context: RemoteSetupContext,
		workspaceClient: CoderApi,
	): vscode.Disposable {
		return this.secretsManager.onDidChangeSessionAuth(
			context.parts.safeHostname,
			async (auth) => {
				workspaceClient.setCredentials(auth?.url, auth?.token);
				if (!auth?.url) {
					return;
				}

				try {
					await this.cliManager.configure(auth.url, auth.token, {
						silent: true,
					});
					this.logger.info(
						"Updated CLI config with new token for remote deployment",
					);
				} catch (error) {
					this.logger.error(
						"Failed to update CLI config for remote deployment",
						error,
					);
				}
			},
		);
	}

	/**
	 * Return the --log-dir argument value for the ProxyCommand, or an empty
	 * string when the CLI does not support it.
	 *
	 * Value defined in the "coder.sshFlags" setting is not considered.
	 */
	private getLogDir(featureSet: FeatureSet): string {
		if (!featureSet.proxyLogDirectory) {
			return "";
		}
		return this.pathResolver.getProxyLogPath();
	}

	/**
	 * Builds the ProxyCommand for SSH connections to Coder workspaces.
	 * Uses `coder ssh` for modern deployments with wildcard support,
	 * or falls back to `coder vscodessh` for older deployments.
	 */
	private async buildProxyCommand(
		binaryPath: string,
		label: string,
		hostPrefix: string,
		logDir: string,
		useWildcardSSH: boolean,
		cliAuth: CliAuth,
	): Promise<string> {
		const vscodeConfig = vscode.workspace.getConfiguration();

		const escapedBinaryPath = escapeCommandArg(binaryPath);
		const globalConfig = getGlobalShellFlags(vscodeConfig, cliAuth);
		const logArgs = await this.getLogArgs(logDir);

		if (useWildcardSSH) {
			// User SSH flags are included first; internally-managed flags
			// are appended last so they take precedence.
			const userSshFlags = getSshFlags(vscodeConfig);
			// Make sure to update the `coder.sshFlags` description if we add more internal flags here!
			const internalFlags = [
				"--stdio",
				"--usage-app=vscode",
				"--network-info-dir",
				escapeCommandArg(this.pathResolver.getNetworkInfoPath()),
				...logArgs,
				"--ssh-host-prefix",
				hostPrefix,
				"%h",
			];

			const allFlags = [...userSshFlags, ...internalFlags];
			return `${escapedBinaryPath} ${globalConfig.join(" ")} ssh ${allFlags.join(" ")}`;
		} else {
			const networkInfoDir = escapeCommandArg(
				this.pathResolver.getNetworkInfoPath(),
			);
			const sessionTokenFile = escapeCommandArg(
				this.pathResolver.getSessionTokenPath(label),
			);
			const urlFile = escapeCommandArg(this.pathResolver.getUrlPath(label));

			const sshFlags = [
				"--network-info-dir",
				networkInfoDir,
				...logArgs,
				"--session-token-file",
				sessionTokenFile,
				"--url-file",
				urlFile,
				"%h",
			];

			return `${escapedBinaryPath} ${globalConfig.join(" ")} vscodessh ${sshFlags.join(" ")}`;
		}
	}

	/**
	 * Returns the --log-dir argument for the ProxyCommand after making sure it
	 * has been created.
	 */
	private async getLogArgs(logDir: string): Promise<string[]> {
		if (!logDir) {
			return [];
		}
		await fs.mkdir(logDir, { recursive: true });
		this.logger.info("SSH proxy diagnostics are being written to", logDir);
		return ["--log-dir", escapeCommandArg(logDir), "-v"];
	}

	private getMainSshConfigPath(): string {
		const configured = getRemoteSshConfigFile();
		return expandPath(configured || path.join("~", ".ssh", "config"));
	}

	// updateSSHConfig updates the SSH configuration with a wildcard that handles
	// all Coder entries.
	private async updateSSHConfig(
		restClient: Api,
		safeHostname: string,
		hostName: string,
		binaryPath: string,
		logDir: string,
		featureSet: FeatureSet,
		cliAuth: CliAuth,
	): Promise<SshProperties> {
		// Our blocks live in our own file; the user's only gains the include.
		const sshConfig = new SshConfig(this.getMainSshConfigPath(), this.logger);
		await sshConfig.load();
		const coderConfigPath = this.pathResolver.getIncludedSshConfigPath();
		const coderConfig = new SshConfig(coderConfigPath, this.logger);
		await coderConfig.load();

		// Options the user set themselves win the merge below, so they are exempt
		// from the deny list. Both sources are local and already trusted: whoever
		// can write the SSH config could write any Host block directly.
		const userConfigSsh = vscode.workspace
			.getConfiguration("coder")
			.get<string[]>("sshConfig", []);
		const userConfig = parseSshConfig(userConfigSsh);
		// The CLI writes its block to the user's config, so read it from there.
		const configSshOptions = parseCoderSshOptions(sshConfig.getRaw());

		let deploymentSshConfig = {};
		try {
			const deploymentConfig = await restClient.getDeploymentSSHConfig();
			deploymentSshConfig = validateDeploymentSshOptions(
				deploymentConfig.ssh_config_options,
				{ ...configSshOptions, ...userConfig },
			);
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
				default:
					throw error;
			}
		}

		// Merge SSH config from three sources (highest to lowest priority):
		// 1. User's VS Code coder.sshConfig setting
		// 2. coder config-ssh --ssh-option flags from the CLI block
		// 3. Deployment SSH config from the coderd API
		// Only 3 is deny listed; 1 and 2 are the user's own options.
		const sshConfigOverrides = mergeSshConfigValues(
			mergeSshConfigValues(deploymentSshConfig, configSshOptions),
			userConfig,
		);

		const hostPrefix = toCurrentAuthorityHostPrefix(safeHostname);

		const proxyCommand = await this.buildProxyCommand(
			binaryPath,
			safeHostname,
			hostPrefix,
			logDir,
			featureSet.wildcardSSH,
			cliAuth,
		);

		const sshValues: SshValues = {
			Host: hostPrefix + `*`,
			ProxyCommand: proxyCommand,
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			LogLevel: "ERROR",
			ServerAliveInterval: "10",
			ServerAliveCountMax: "3",
		};
		if (sshSupportsSetEnv()) {
			// This allows for tracking the number of extension
			// users connected to workspaces!
			sshValues.SetEnv = "CODER_SSH_SESSION_TYPE=vscode";
		}

		// Write our file before including it, so the include never dangles.
		await coderConfig.update(safeHostname, sshValues, sshConfigOverrides);
		await sshConfig.updateInclude(
			{
				id: vscode.env.uriScheme,
				includePath: coderConfigPath,
			},
			safeHostname,
		);

		// Mirror SSH's parse order; RemoteCommand can come from the user's config.
		return computeSshProperties(
			hostName,
			`${coderConfig.getRaw()}\n${sshConfig.getRaw()}`,
		);
	}

	private watchSettings(
		settings: Array<{
			setting: string;
			title: string;
			getValue: () => unknown;
		}>,
	): vscode.Disposable {
		const titleMap = new Map(settings.map((s) => [s.setting, s.title]));

		return watchConfigurationChanges(
			settings,
			(changes) => {
				const changedTitles = [...changes.keys()]
					.map((s) => titleMap.get(s))
					.filter((t) => t !== undefined);

				const message =
					changedTitles.length === 1
						? `${changedTitles[0]} setting changed. Reload window to apply.`
						: `${changedTitles.join(", ")} settings changed. Reload window to apply.`;

				vscode.window
					.showInformationMessage(message, "Reload")
					.then((action) => {
						if (action === "Reload") {
							vscode.commands.executeCommand("workbench.action.reloadWindow");
						}
					});
			},
			{ debounceMs: CONFIG_CHANGE_DEBOUNCE_MS },
		);
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
		const statusBarItem = createStatusBarItem("agentMetadata");

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
		return vscodeProposed.workspace.registerResourceLabelFormatter({
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
