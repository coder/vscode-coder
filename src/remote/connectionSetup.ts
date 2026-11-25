import { isAxiosError } from "axios";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as semver from "semver";
import * as vscode from "vscode";

import { HttpStatusCode } from "../api/httpStatusCode";
import { version as cliVersion } from "../cli/cliExec";
import {
	escapeCommandArg,
	escapeProxyCommandPath,
	lowercase,
} from "../common/strings";
import { toError } from "../error/normalize";
import {
	cliFeatureSet,
	serverFeatureSet,
	type ServerFeatureSet,
} from "../featureSet";
import {
	type CliAuth,
	getGlobalShellFlags,
	getSshFlags,
	resolveCliAuth,
} from "../settings/cli";
import { vscodeProposed } from "../vscode/proposed";

import { type AuthorityParts, hostEditorId } from "./authority";
import { SESSION_TYPE_ENV } from "./environment";
import {
	getHomeSshConfigPath,
	getSshHomeDir,
	SshConfig,
	type SshValues,
	mergeSshConfigValues,
	parseCoderSshOptions,
	parseSshConfig,
	validateDeploymentSshOptions,
} from "./sshConfig";
import {
	computeSshProperties,
	resolveSshProperties,
	type SshProperties,
} from "./sshSupport";
import { createManagedPermissions } from "./windowsAcl";

import type { Api } from "coder/site/src/api/api";
import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { CliManager } from "../cli/cliManager";
import type { ServiceContainer } from "../container";
import type { Logger } from "../logging/logger";
import type { MementoManager } from "../storage/mementoManager";
import type { PathResolver } from "../storage/pathResolver";
import type { WorkspaceMonitor } from "../workspace/workspaceMonitor";

import type { WorkspaceStateMachine } from "./workspaceStateMachine";

export interface Compatibility {
	serverFeatures: ServerFeatureSet;
	cliAuth: CliAuth;
	sessionApp: string;
}

export interface SshConfigOptions {
	workspaceClient: Api;
	parts: AuthorityParts;
	binaryPath: string;
	logDir: string;
	cliAuth: CliAuth;
	sessionApp: string;
	/** Passed to ssh as `-F`; undefined uses `~/.ssh/config`. */
	configFile: string | undefined;
	/** The ssh binary that resolves the host; undefined uses `ssh` on PATH. */
	sshPath: string | undefined;
}

/**
 * Steps that prepare a workspace for an SSH connection, independent of the
 * window that connects: CLI resolution, compatibility, readiness and the SSH
 * config.
 */
export class ConnectionSetup {
	private readonly logger: Logger;
	private readonly pathResolver: PathResolver;
	private readonly cliManager: CliManager;
	private readonly mementoManager: MementoManager;

	public constructor(
		serviceContainer: ServiceContainer,
		private readonly extensionMode: vscode.ExtensionMode,
	) {
		this.logger = serviceContainer.getLogger();
		this.pathResolver = serviceContainer.getPathResolver();
		this.cliManager = serviceContainer.getCliManager();
		this.mementoManager = serviceContainer.getMementoManager();
	}

	public async resolveBinary(workspaceClient: Api): Promise<string> {
		if (this.extensionMode === vscode.ExtensionMode.Production) {
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
	 * Resolve server and CLI capabilities independently, disabling optional CLI
	 * features when its version can't be read.
	 */
	public async checkCompatibility(options: {
		workspaceClient: Api;
		binaryPath: string;
		baseUrl: string;
		safeHostname: string;
	}): Promise<Compatibility> {
		const { workspaceClient, binaryPath, baseUrl, safeHostname } = options;
		const buildInfo = await workspaceClient.getBuildInfo();
		const serverVersion = semver.parse(buildInfo.version);

		let parsedCliVersion: semver.SemVer | null;
		try {
			parsedCliVersion = semver.parse(await cliVersion(binaryPath));
		} catch {
			parsedCliVersion = null;
		}
		const cliFeatures = cliFeatureSet(parsedCliVersion);
		const serverFeatures = serverFeatureSet(serverVersion);
		// Report schemes verbatim; normalization and editor families belong to the server.
		const sessionApp =
			cliFeatures.customSessionAppNames && serverFeatures.customSessionAppNames
				? vscode.env.uriScheme || "vscode"
				: "vscode";
		const configDir = this.pathResolver.getGlobalConfigDir(safeHostname);
		const cliAuth = resolveCliAuth(
			vscode.workspace.getConfiguration(),
			cliFeatures,
			baseUrl,
			configDir,
		);
		return {
			serverFeatures,
			cliAuth,
			sessionApp,
		};
	}

	public async waitForWorkspaceReady(
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

	public async writeSshConfig(
		options: SshConfigOptions,
	): Promise<SshProperties> {
		try {
			this.logger.info("Updating SSH config...");
			return await this.updateSSHConfig(options);
		} catch (error) {
			this.logger.warn("Failed to configure SSH", error);
			throw error;
		}
	}

	/**
	 * Returns the --log-dir argument for the ProxyCommand after making sure it
	 * has been created.
	 */
	private async getLogArgs(logDir: string): Promise<string[]> {
		await fs.mkdir(logDir, { recursive: true });
		this.logger.info("SSH proxy diagnostics are being written to", logDir);
		return ["--log-dir", escapeProxyCommandPath(logDir), "-v"];
	}

	// updateSSHConfig updates the SSH configuration with a wildcard that handles
	// all Coder entries.
	private async updateSSHConfig({
		workspaceClient,
		parts,
		binaryPath,
		logDir,
		cliAuth,
		sessionApp,
		configFile,
		sshPath,
	}: SshConfigOptions): Promise<SshProperties> {
		// Taken from the authority, so a legacy host keeps working.
		const { hostPrefix, safeHostname, sshHost } = parts;
		// One file per (host prefix, deployment); the user's config gains one shared include.
		const sshConfig = new SshConfig(
			configFile ?? path.join(os.homedir(), ".ssh", "config"),
			this.logger,
		);
		await sshConfig.load();
		// Never loaded: update() regenerates it without reading the old content.
		const coderConfig = new SshConfig(
			this.pathResolver.getSshConfigPath(safeHostname, hostEditorId(sshHost)),
			this.logger,
			undefined,
			createManagedPermissions(),
		);

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
			const deploymentConfig = await workspaceClient.getDeploymentSSHConfig();
			const { options, ignored } = validateDeploymentSshOptions(
				deploymentConfig.ssh_config_options,
				{ ...configSshOptions, ...userConfig },
			);
			deploymentSshConfig = options;
			if (ignored.length > 0) {
				this.logger.warn("Ignoring deployment SSH options", ignored);
				this.warnIgnoredSshOptions(safeHostname, ignored);
			}
		} catch (error) {
			if (!isAxiosError(error)) {
				throw error;
			}
			switch (error.response?.status) {
				case HttpStatusCode.NOT_FOUND: {
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

		const proxyCommand = buildSshProxyCommand({
			pathResolver: this.pathResolver,
			binaryPath,
			cliAuth,
			logArgs: await this.getLogArgs(logDir),
			sessionApp,
			hostPrefix,
		});

		const sshValues: SshValues = {
			Host: hostPrefix + `*`,
			ProxyCommand: proxyCommand,
			ConnectTimeout: "0",
			StrictHostKeyChecking: "no",
			UserKnownHostsFile: "/dev/null",
			PermitLocalCommand: "no",
			LogLevel: "ERROR",
			ServerAliveInterval: "10",
			ServerAliveCountMax: "3",
			SendEnv: SESSION_TYPE_ENV,
		};

		// Write our file before including it, so the include never dangles.
		await coderConfig.update(sshValues, sshConfigOverrides);
		const includeDir = this.pathResolver.getSshConfigDir();
		const sshHomeDir = await getSshHomeDir();
		await sshConfig.updateInclude(includeDir, sshHomeDir, safeHostname);
		// Without -F, Git for Windows ssh reads HOME's config, not the profile's.
		const homeConfigPath = getHomeSshConfigPath(sshHomeDir);
		if (!configFile && homeConfigPath) {
			try {
				await new SshConfig(homeConfigPath, this.logger).updateInclude(
					includeDir,
					sshHomeDir,
					safeHostname,
				);
			} catch (error) {
				this.logger.warn(
					"Failed to include the Coder SSH config in",
					homeConfigPath,
					error,
				);
			}
		}

		try {
			return await resolveSshProperties(sshPath, parts.sshHost, configFile);
		} catch (error) {
			this.logger.warn("ssh -G failed, parsing the SSH config instead", error);
			return computeSshProperties(
				parts.sshHost,
				`${coderConfig.getRaw()}\n${sshConfig.getRaw()}`,
			);
		}
	}

	/** Stays hidden while every ignored option was already dismissed. */
	private warnIgnoredSshOptions(safeHostname: string, ignored: string[]): void {
		const memento = this.mementoManager;
		const dismissed = new Set(memento.getDismissedSshOptions(safeHostname));
		const keys = ignored.map(lowercase);
		if (keys.every((key) => dismissed.has(key))) {
			return;
		}
		const dontShow = "Don't Show Again";
		void vscode.window
			.showWarningMessage(
				`Ignored SSH options from the Coder deployment that could expose your machine: ${ignored.join(", ")}. To use them, add them to the "coder.sshConfig" setting.`,
				dontShow,
			)
			.then((choice) =>
				choice === dontShow
					? memento.addDismissedSshOptions(safeHostname, keys)
					: undefined,
			);
	}
}

interface ProxyCommandOptions {
	pathResolver: PathResolver;
	binaryPath: string;
	cliAuth: CliAuth;
	logArgs: string[];
	sessionApp: string;
	hostPrefix: string;
}

/** SSH ProxyCommand using wildcard workspace hosts. */
export function buildSshProxyCommand(options: ProxyCommandOptions): string {
	// Make sure to update the `coder.sshFlags` description if we add more internal flags here!
	const internalFlags = [
		"--stdio",
		`--usage-app=${escapeCommandArg(options.sessionApp)}`,
		"--network-info-dir",
		escapeProxyCommandPath(options.pathResolver.getNetworkInfoPath()),
		...options.logArgs,
		"--ssh-host-prefix",
		options.hostPrefix,
		"%h",
	];
	// User SSH flags are included first; internally-managed flags
	// are appended last so they take precedence.
	const configs = vscode.workspace.getConfiguration();
	const userSshFlags = getSshFlags(configs);
	const globalFlags = getGlobalShellFlags(configs, options.cliAuth);
	return `${escapeProxyCommandPath(options.binaryPath)} ${globalFlags.join(" ")} ssh ${[...userSshFlags, ...internalFlags].join(" ")}`;
}
