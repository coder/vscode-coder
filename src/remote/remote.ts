import { isAxiosError } from "axios";
import * as vscode from "vscode";

import {
	createAgentMetadataWatcher,
	getEventValue,
	formatEventLabel,
	formatMetadataError,
} from "../api/agentMetadata";
import { AuthInterceptor } from "../api/authInterceptor";
import { CoderApi } from "../api/coderApi";
import { HttpStatusCode } from "../api/httpStatusCode";
import { extractAgents } from "../api/models";
import {
	CONFIG_CHANGE_DEBOUNCE_MS,
	watchConfigurationChanges,
} from "../configWatcher";
import { raceWithAbort, throwIfAborted } from "../error/abort";
import { toError } from "../error/normalize";
import { Inbox } from "../inbox";
import { AuthTelemetry } from "../instrumentation/auth";
import {
	RemoteSetupTelemetry,
	type RemoteSetupTracer,
} from "../instrumentation/remoteSetup";
import { OAuthSessionManager } from "../oauth/sessionManager";
import { getExpandedUserGlobalFlags, getSshFlags } from "../settings/cli";
import { getHeaderCommand } from "../settings/headers";
import { createStatusBarItem } from "../ui/statusBar";
import { vscodeProposed } from "../vscode/proposed";
import { WorkspaceMonitor } from "../workspace/workspaceMonitor";

import {
	type AuthorityParts,
	classifySshHost,
	parseRemoteAuthority,
	sshHostOf,
} from "./authority";
import { applySshEnvironment, SSH_PROXY_SETTINGS } from "./environment";
import { migrateAuthToSecretsStorage } from "./migration";
import { getRemoteSshConfigFile, getRemoteSshPath } from "./sshExtension";
import { applySettingOverrides, buildSshOverrides } from "./sshOverrides";
import { SshProcessMonitor } from "./sshProcess";
import { WorkspaceStateMachine } from "./workspaceStateMachine";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CliManager } from "../cli/cliManager";
import type { Commands } from "../commands";
import type { ServiceContainer } from "../container";
import type { Logger } from "../logging/logger";
import type { LoginCoordinator } from "../login/loginCoordinator";
import type { StartupMode } from "../storage/mementoManager";
import type { PathResolver } from "../storage/pathResolver";
import type { SecretsManager, SessionAuth } from "../storage/secretsManager";
import type { ContextManager } from "../vscode/contextManager";

import type { ConnectionSetup } from "./connectionSetup";

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

/**
 * What Open Recent shows after the path. VS Code splits the label on the
 * separator, so "/" would display "/home/kyle [Coder: kyle/workspace]" as
 * "workspace] /home/kyle [Coder: kyle"; "∕" looks the same in the UI font.
 */
export function workspaceLabelSuffix(
	remoteAuthority: string,
	owner: string,
	workspace: string,
	agent?: string,
): string {
	let suffix = `Coder: ${owner}∕${workspace}`;
	if (agent) {
		suffix += `∕${agent}`;
	}
	// Mark the shared host, so a workspace with an entry on each is not two
	// identical lines. Only a fork sees it; in VS Code it is the only host.
	const sshHost = sshHostOf(remoteAuthority);
	return sshHost && classifySshHost(sshHost) === "legacy"
		? `${suffix} (legacy)`
		: suffix;
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
		private readonly connectionSetup: ConnectionSetup,
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

		if (!context.baseUrl || context.token === undefined) {
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
				this.connectionSetup.resolveBinary(workspaceClient),
			);

			const { serverFeatures, cliAuth, sessionApp } = await tracer.phase(
				"compatibility_check",
				() =>
					this.connectionSetup.checkCompatibility({
						workspaceClient,
						binaryPath,
						baseUrl,
						safeHostname: parts.safeHostname,
					}),
			);
			disposables.push(
				applySshEnvironment(
					vscode.workspace.getConfiguration(),
					this.extensionContext.environmentVariableCollection,
					sessionApp,
				),
			);

			// Write token to keyring or file
			if (baseUrl && token !== undefined) {
				await tracer.phase("cli_configure", () =>
					this.cliManager.configure(baseUrl, token),
				);
			}

			// Listen for token changes for this deployment
			disposables.push(
				this.watchRemoteSessionAuth(
					parts.safeHostname,
					workspaceClient,
					remoteOAuthManager,
				),
			);

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
				serverFeatures,
				cliAuth,
				this.serviceContainer,
			);
			disposables.push(stateMachine);

			try {
				workspace = await tracer.phase("workspace_ready", () =>
					this.connectionSetup.waitForWorkspaceReady(
						workspace,
						monitor,
						stateMachine,
					),
				);
			} finally {
				stateMachine.dispose();
			}

			const agent = await tracer.phase("agent_resolve", () =>
				this.resolveAgent(context, workspace, stateMachine),
			);

			// Lets the monitor start notifying about state changes.
			monitor.markInitialSetupComplete(agent.id);

			// Watch coder inbox for messages
			const inbox = await Inbox.create(workspace, workspaceClient, this.logger);
			disposables.push(inbox);

			const logDir = this.pathResolver.getProxyLogPath();

			const computedSshProperties = await tracer.phase("ssh_config_write", () =>
				this.connectionSetup.writeSshConfig({
					parts: context.parts,
					workspaceClient,
					binaryPath,
					logDir,
					cliAuth,
					sessionApp,
					// -F skips /etc/ssh/ssh_config, so use it only when Remote-SSH does.
					configFile: getRemoteSshConfigFile(),
					sshPath: getRemoteSshPath(),
				}),
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
					proxyLogDir: logDir,
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
				{
					setting: "coder.proxyLogDirectory",
					title: "Proxy Log Directory",
					getValue: () => this.pathResolver.getProxyLogPath(),
				},
				...SSH_PROXY_SETTINGS,
			];
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
				case HttpStatusCode.NOT_FOUND: {
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

	/**
	 * Rebind the workspace client when this deployment's stored session changes.
	 * Pending requests survive only a token rotation for the same user and URL.
	 */
	private watchRemoteSessionAuth(
		safeHostname: string,
		workspaceClient: CoderApi,
		oauth: OAuthSessionManager,
	): vscode.Disposable {
		// This lookup may itself refresh OAuth, so updates await it instead of blocking on it.
		let boundUserId = workspaceClient.getAuthenticatedUser().then(
			(user) => user.id,
			() => undefined,
		);
		let disposed = false;
		let latestUpdate = new AbortController();

		const listener = this.secretsManager.onDidChangeSessionAuth(
			safeHostname,
			async (auth) => {
				if (disposed) {
					return;
				}
				latestUpdate.abort();
				latestUpdate = new AbortController();
				const signal = latestUpdate.signal;

				if (!auth) {
					boundUserId = Promise.resolve(undefined);
					workspaceClient.setCredentials(undefined, undefined);
					oauth.clearDeployment();
					return;
				}

				try {
					const [previousUserId, userId] = await Promise.all([
						boundUserId,
						this.fetchUserId(auth, signal),
					]);
					throwIfAborted(signal);

					boundUserId = Promise.resolve(userId);
					if (
						auth.url === workspaceClient.getHost() &&
						userId === previousUserId
					) {
						workspaceClient.setSessionToken(auth.token);
					} else {
						workspaceClient.setCredentials(auth.url, auth.token);
						await oauth.setDeployment({ url: auth.url, safeHostname });
						throwIfAborted(signal);
					}

					await this.cliManager.configure(auth.url, auth.token, {
						silent: true,
					});
					this.logger.info(
						"Updated CLI config with new token for remote deployment",
					);
				} catch (error) {
					if (!signal.aborted) {
						this.logger.error(
							"Failed to update credentials for remote deployment",
							toError(error).message,
						);
					}
				}
			},
		);

		return {
			dispose: () => {
				disposed = true;
				latestUpdate.abort();
				listener.dispose();
			},
		};
	}

	/** Resolve the user `auth` belongs to without touching the workspace client. */
	private async fetchUserId(
		auth: SessionAuth,
		signal: AbortSignal,
	): Promise<string> {
		const client = CoderApi.create(auth.url, auth.token, this.logger);
		try {
			return (await raceWithAbort(client.getAuthenticatedUser(), signal)).id;
		} finally {
			client.dispose();
		}
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
		this.logger.flush("remote_closed");
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
				workspaceSuffix: workspaceLabelSuffix(
					remoteAuthority,
					owner,
					workspace,
					agent,
				),
			},
		});
	}
}
