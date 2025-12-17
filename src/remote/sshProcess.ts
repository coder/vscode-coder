import find from "find-process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import prettyBytes from "pretty-bytes";
import * as vscode from "vscode";

import { type Logger } from "../logging/logger";
import { findPort } from "../util";

/**
 * Network information from the Coder CLI.
 */
export interface NetworkInfo {
	p2p: boolean;
	latency: number;
	preferred_derp: string;
	derp_latency: { [key: string]: number };
	upload_bytes_sec: number;
	download_bytes_sec: number;
	using_coder_connect: boolean;
}

/**
 * Options for creating an SshProcessMonitor.
 */
export interface SshProcessMonitorOptions {
	sshHost: string;
	networkInfoPath: string;
	proxyLogDir?: string;
	logger: Logger;
	// Initial poll interval for SSH process and file discovery (ms)
	discoveryPollIntervalMs?: number;
	// Maximum backoff interval for process and file discovery (ms)
	maxDiscoveryBackoffMs?: number;
	// Poll interval for network info updates
	networkPollInterval?: number;
	// For port-based SSH process discovery
	codeLogDir: string;
	remoteSshExtensionId: string;
}

/**
 * Monitors the SSH process for a Coder workspace connection and displays
 * network status in the VS Code status bar.
 */
export class SshProcessMonitor implements vscode.Disposable {
	private readonly statusBarItem: vscode.StatusBarItem;
	private readonly options: Required<
		SshProcessMonitorOptions & { proxyLogDir: string | undefined }
	>;

	private readonly _onLogFilePathChange = new vscode.EventEmitter<
		string | undefined
	>();
	private readonly _onPidChange = new vscode.EventEmitter<number | undefined>();

	/**
	 * Event fired when the log file path changes (e.g., after reconnecting to a new process).
	 */
	public readonly onLogFilePathChange = this._onLogFilePathChange.event;

	/**
	 * Event fired when the SSH process PID changes (e.g., after reconnecting).
	 */
	public readonly onPidChange = this._onPidChange.event;

	private disposed = false;
	private currentPid: number | undefined;
	private logFilePath: string | undefined;
	private pendingTimeout: NodeJS.Timeout | undefined;
	private lastStaleSearchTime = 0;

	private constructor(options: SshProcessMonitorOptions) {
		this.options = {
			...options,
			proxyLogDir: options.proxyLogDir,
			discoveryPollIntervalMs: options.discoveryPollIntervalMs ?? 1000,
			maxDiscoveryBackoffMs: options.maxDiscoveryBackoffMs ?? 30_000,
			// Matches the SSH update interval
			networkPollInterval: options.networkPollInterval ?? 3000,
		};
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			1000,
		);
	}

	/**
	 * Creates and starts an SSH process monitor.
	 * Begins searching for the SSH process in the background.
	 */
	public static start(options: SshProcessMonitorOptions): SshProcessMonitor {
		const monitor = new SshProcessMonitor(options);
		monitor.searchForProcess().catch((err) => {
			options.logger.error("Error in SSH process monitor", err);
		});
		return monitor;
	}

	/**
	 * Returns the path to the log file for this connection, or undefined if not found.
	 */
	getLogFilePath(): string | undefined {
		return this.logFilePath;
	}

	/**
	 * Cleans up resources and stops monitoring.
	 */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (this.pendingTimeout) {
			clearTimeout(this.pendingTimeout);
			this.pendingTimeout = undefined;
		}
		this.statusBarItem.dispose();
		this._onLogFilePathChange.dispose();
		this._onPidChange.dispose();
	}

	/**
	 * Delays for the specified duration. Returns early if disposed.
	 */
	private async delay(ms: number): Promise<void> {
		if (this.disposed) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.pendingTimeout = setTimeout(() => {
				this.pendingTimeout = undefined;
				resolve();
			}, ms);
		});
	}

	/**
	 * Searches for the SSH process indefinitely until found or disposed.
	 * Starts monitoring when it finds the process through the port.
	 */
	private async searchForProcess(): Promise<void> {
		const { discoveryPollIntervalMs, maxDiscoveryBackoffMs, logger, sshHost } =
			this.options;
		let attempt = 0;
		let currentBackoff = discoveryPollIntervalMs;

		while (!this.disposed) {
			attempt++;

			if (attempt === 1 || attempt % 10 === 0) {
				logger.debug(
					`SSH process search attempt ${attempt} for host: ${sshHost}`,
				);
			}

			const pidByPort = await this.findSshProcessByPort();
			if (pidByPort !== undefined) {
				this.setCurrentPid(pidByPort);
				this.startMonitoring();
				return;
			}

			await this.delay(currentBackoff);
			currentBackoff = Math.min(currentBackoff * 2, maxDiscoveryBackoffMs);
		}
	}

	/**
	 * Finds SSH process by parsing the Remote SSH extension's log to get the port.
	 * This is more accurate as each VS Code window has a unique port.
	 */
	private async findSshProcessByPort(): Promise<number | undefined> {
		const { codeLogDir, remoteSshExtensionId, logger } = this.options;

		try {
			const logPath = await findRemoteSshLogPath(
				codeLogDir,
				remoteSshExtensionId,
				logger,
			);
			if (!logPath) {
				return undefined;
			}

			const logContent = await fs.readFile(logPath, "utf8");
			this.options.logger.debug(`Read Remote SSH log file:`, logPath);

			const port = findPort(logContent);
			if (!port) {
				return undefined;
			}
			this.options.logger.debug(`Found SSH port ${port} in log file`);

			const processes = await find("port", port);
			if (processes.length === 0) {
				return undefined;
			}

			return processes[0].pid;
		} catch (error) {
			logger.debug(`Port-based SSH process search failed: ${error}`);
			return undefined;
		}
	}

	/**
	 * Updates the current PID and fires change events.
	 */
	private setCurrentPid(pid: number): void {
		const previousPid = this.currentPid;
		this.currentPid = pid;

		if (previousPid === undefined) {
			this.options.logger.info(`SSH connection established (PID: ${pid})`);
			this._onPidChange.fire(pid);
		} else if (previousPid !== pid) {
			this.options.logger.info(
				`SSH process changed from ${previousPid} to ${pid}`,
			);
			this.logFilePath = undefined;
			this._onLogFilePathChange.fire(undefined);
			this._onPidChange.fire(pid);
		}
	}

	/**
	 * Starts monitoring tasks after finding the SSH process.
	 */
	private startMonitoring(): void {
		if (this.disposed || this.currentPid === undefined) {
			return;
		}
		this.searchForLogFile();
		this.monitorNetwork();
	}

	/**
	 * Searches for the log file for the current PID.
	 * Polls until found or PID changes.
	 */
	private async searchForLogFile(): Promise<void> {
		const {
			proxyLogDir: logDir,
			logger,
			discoveryPollIntervalMs,
			maxDiscoveryBackoffMs,
		} = this.options;
		if (!logDir) {
			return;
		}

		let currentBackoff = discoveryPollIntervalMs;

		const targetPid = this.currentPid;
		while (!this.disposed && this.currentPid === targetPid) {
			try {
				const logFiles = (await fs.readdir(logDir))
					.sort((a, b) => a.localeCompare(b))
					.reverse();
				const logFileName = logFiles.find(
					(file) =>
						file === `${targetPid}.log` || file.endsWith(`-${targetPid}.log`),
				);

				if (logFileName) {
					const foundPath = path.join(logDir, logFileName);
					if (foundPath !== this.logFilePath) {
						this.logFilePath = foundPath;
						logger.info(`Log file found: ${this.logFilePath}`);
						this._onLogFilePathChange.fire(this.logFilePath);
					}
					return;
				}
			} catch {
				logger.debug(`Could not read log directory: ${logDir}`);
			}

			await this.delay(currentBackoff);
			currentBackoff = Math.min(currentBackoff * 2, maxDiscoveryBackoffMs);
		}
	}

	/**
	 * Monitors network info and updates the status bar.
	 * Checks file mtime to detect stale connections and trigger reconnection search.
	 */
	private async monitorNetwork(): Promise<void> {
		const { networkInfoPath, networkPollInterval, logger } = this.options;
		const staleThreshold = networkPollInterval * 5;

		while (!this.disposed && this.currentPid !== undefined) {
			const networkInfoFile = path.join(
				networkInfoPath,
				`${this.currentPid}.json`,
			);

			try {
				const stats = await fs.stat(networkInfoFile);
				const ageMs = Date.now() - stats.mtime.getTime();

				if (ageMs > staleThreshold) {
					// Prevent tight loop: if we just searched due to stale, wait before searching again
					const timeSinceLastSearch = Date.now() - this.lastStaleSearchTime;
					if (timeSinceLastSearch < staleThreshold) {
						await this.delay(staleThreshold - timeSinceLastSearch);
						continue;
					}

					logger.debug(
						`Network info stale (${Math.round(ageMs / 1000)}s old), searching for new SSH process`,
					);

					// searchForProcess will update PID if a different process is found
					this.lastStaleSearchTime = Date.now();
					await this.searchForProcess();
					return;
				}

				const content = await fs.readFile(networkInfoFile, "utf8");
				const network = JSON.parse(content) as NetworkInfo;
				const isStale = ageMs > this.options.networkPollInterval * 2;
				this.updateStatusBar(network, isStale);
			} catch (error) {
				logger.debug(
					`Failed to read network info: ${(error as Error).message}`,
				);
			}

			await this.delay(networkPollInterval);
		}
	}

	/**
	 * Updates the status bar with network information.
	 */
	private updateStatusBar(network: NetworkInfo, isStale: boolean): void {
		let statusText = "$(globe) ";

		// Coder Connect doesn't populate any other stats
		if (network.using_coder_connect) {
			this.statusBarItem.text = statusText + "Coder Connect ";
			this.statusBarItem.tooltip = "You're connected using Coder Connect.";
			this.statusBarItem.show();
			return;
		}

		if (network.p2p) {
			statusText += "Direct ";
			this.statusBarItem.tooltip = "You're connected peer-to-peer ✨.";
		} else {
			statusText += network.preferred_derp + " ";
			this.statusBarItem.tooltip =
				"You're connected through a relay 🕵.\nWe'll switch over to peer-to-peer when available.";
		}

		let tooltip = this.statusBarItem.tooltip;
		tooltip +=
			"\n\nDownload ↓ " +
			prettyBytes(network.download_bytes_sec, { bits: true }) +
			"/s • Upload ↑ " +
			prettyBytes(network.upload_bytes_sec, { bits: true }) +
			"/s\n";

		if (!network.p2p) {
			const derpLatency = network.derp_latency[network.preferred_derp];
			tooltip += `You ↔ ${derpLatency.toFixed(2)}ms ↔ ${network.preferred_derp} ↔ ${(network.latency - derpLatency).toFixed(2)}ms ↔ Workspace`;

			let first = true;
			for (const region of Object.keys(network.derp_latency)) {
				if (region === network.preferred_derp) {
					continue;
				}
				if (first) {
					tooltip += `\n\nOther regions:`;
					first = false;
				}
				tooltip += `\n${region}: ${Math.round(network.derp_latency[region] * 100) / 100}ms`;
			}
		}

		this.statusBarItem.tooltip = tooltip;
		const latencyText = isStale
			? `(~${network.latency.toFixed(2)}ms)`
			: `(${network.latency.toFixed(2)}ms)`;
		statusText += latencyText;
		this.statusBarItem.text = statusText;
		this.statusBarItem.show();
	}
}

/**
 * Finds the Remote SSH extension's log file path.
 * Tries extension-specific folder first (Cursor, Windsurf, Antigravity),
 * then output_logging_ fallback (MS VS Code).
 */
async function findRemoteSshLogPath(
	codeLogDir: string,
	extensionId: string,
	logger: Logger,
): Promise<string | undefined> {
	const logsParentDir = path.dirname(codeLogDir);

	// Try extension-specific folder (for VS Code clones like Cursor, Windsurf)
	try {
		const extensionLogDir = path.join(logsParentDir, extensionId);
		const remoteSshLog = await findSshLogInDir(extensionLogDir);
		if (remoteSshLog) {
			return remoteSshLog;
		}

		logger.debug(
			`Extension log folder exists but no Remote SSH log found: ${extensionLogDir}`,
		);
	} catch {
		// Extension-specific folder doesn't exist - expected for MS VS Code, try fallback
	}

	try {
		const dirs = await fs.readdir(logsParentDir);
		const outputDirs = dirs
			.filter((d) => d.startsWith("output_logging_"))
			.sort((a, b) => a.localeCompare(b))
			.reverse();

		if (outputDirs.length > 0) {
			const outputPath = path.join(logsParentDir, outputDirs[0]);
			const remoteSshLog = await findSshLogInDir(outputPath);
			if (remoteSshLog) {
				return remoteSshLog;
			}

			logger.debug(
				`Output logging folder exists but no Remote SSH log found: ${outputPath}`,
			);
		} else {
			logger.debug(`No output_logging_ folders found in: ${logsParentDir}`);
		}
	} catch {
		logger.debug(`Could not read logs parent directory: ${logsParentDir}`);
	}

	return undefined;
}

async function findSshLogInDir(dirPath: string): Promise<string | undefined> {
	const files = await fs.readdir(dirPath);
	const remoteSshLog = files.find((f) => f.includes("Remote - SSH"));
	return remoteSshLog ? path.join(dirPath, remoteSshLog) : undefined;
}
