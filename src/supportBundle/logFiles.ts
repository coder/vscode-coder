import * as path from "node:path";

import { type Logger } from "../logging/logger";
import {
	isOutputLoggingDir,
	isRemoteSshExtensionDir,
	isSharedChannelRemoteSshLog,
} from "../remote/sshExtension";

import {
	addFiles,
	collectDirFiles,
	collectMatchingFiles,
	type CollectedFile,
	isLogFile,
	normalizeZipPath,
	prefixFiles,
	readDirents,
	readLogFile,
} from "./files";
import { collectSettingsFile } from "./settings";

export interface LogSources {
	activeProxyLogPath?: string;
	proxyLogDir?: string;
	extensionLogDir?: string;
}

interface WindowLogDir {
	relativePath: string;
	windowPath: string;
}

interface LogContext {
	currentWindowPath: string;
	logsRoot: string;
}

/**
 * Proxy, Remote-SSH, and extension logs from recent windows plus a redacted
 * settings snapshot, keyed by zip path under `vscode-logs/`.
 */
export async function collectVsCodeDiagnostics(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = await collectSupportLogFiles(sources, logger);
	const settings = collectSettingsFile(logger);
	if (settings) {
		files.set("vscode-logs/settings.json", settings);
	}
	return files;
}

export async function collectSupportLogFiles(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = await collectProxyLogs(sources, logger);
	if (sources.extensionLogDir) {
		addFiles(
			files,
			await collectVsCodeWindowLogs(sources.extensionLogDir, logger),
		);
	}
	return files;
}

export function resolveLogContext(
	extensionLogDir: string,
): LogContext | undefined {
	const resolved = path.resolve(extensionLogDir);
	const exthostDir = path.dirname(resolved);
	const windowDir = path.dirname(exthostDir);
	const windowName = path.basename(windowDir);
	const sessionDir = path.dirname(windowDir);

	// Match the layout, not the id: forks rebrand it.
	if (
		path.basename(exthostDir) !== "exthost" ||
		!/^window\d+$/i.test(windowName)
	) {
		return undefined;
	}

	const sessionName = path.basename(sessionDir);
	return {
		currentWindowPath: windowDir,
		// Anchored so `20240101T000000-foo` doesn't widen logsRoot.
		logsRoot: /^\d{8}T\d{6}$/.test(sessionName)
			? path.dirname(sessionDir)
			: sessionDir,
	};
}

export async function collectWindowLogDirs(
	logsRoot: string,
	logger: Logger,
): Promise<WindowLogDir[]> {
	const windows: WindowLogDir[] = [];
	await Promise.all(
		(await readDirents(logsRoot, logger)).map(async (entry) => {
			if (!entry.isDirectory()) return;
			const entryPath = path.join(logsRoot, entry.name);
			if (/^window\d+$/i.test(entry.name)) {
				windows.push({ relativePath: entry.name, windowPath: entryPath });
				return;
			}
			for (const sub of await readDirents(entryPath, logger)) {
				if (sub.isDirectory() && /^window\d+$/i.test(sub.name)) {
					windows.push({
						relativePath: `${entry.name}/${sub.name}`,
						windowPath: path.join(entryPath, sub.name),
					});
				}
			}
		}),
	);
	return windows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function collectProxyLogs(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	const activeBasename = sources.activeProxyLogPath
		? path.basename(sources.activeProxyLogPath)
		: undefined;

	if (sources.activeProxyLogPath && activeBasename) {
		// No age cutoff: long sessions outlive the window.
		const file = await readLogFile(sources.activeProxyLogPath, logger);
		if (file) {
			files.set(`vscode-logs/proxy/${activeBasename}`, file.data);
		}
	}

	if (sources.proxyLogDir) {
		addFiles(
			files,
			prefixFiles(
				"vscode-logs/proxy",
				// Already added above; don't double-bundle.
				await collectDirFiles(
					sources.proxyLogDir,
					logger,
					(name) => isProxyLogFile(name) && name !== activeBasename,
				),
			),
		);
	}
	return files;
}

async function collectVsCodeWindowLogs(
	extensionLogDir: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	const context = resolveLogContext(extensionLogDir);

	if (!context) {
		// Non-canonical layout: scan the ext dir and assumed window dir.
		addFiles(
			files,
			prefixFiles(
				"vscode-logs/extension",
				await collectDirFiles(extensionLogDir, logger, isLogFile),
			),
		);
		const exthostDir = path.dirname(extensionLogDir);
		const windowDir =
			path.basename(exthostDir) === "exthost"
				? path.dirname(exthostDir)
				: exthostDir;
		for (const log of await collectMatchingFiles(
			windowDir,
			logger,
			isRemoteSshLog,
		)) {
			files.set(
				`vscode-logs/remote-ssh/${normalizeZipPath(log.relativePath)}`,
				log.data,
			);
		}
		return files;
	}

	const extensionId = path.basename(extensionLogDir);
	const currentWindowSshLogs: CollectedFile[] = [];

	for (const window of await collectWindowLogDirs(context.logsRoot, logger)) {
		const extLogs = await collectDirFiles(
			path.join(window.windowPath, "exthost", extensionId),
			logger,
			isLogFile,
			false,
		);
		// Window never hosted Coder; its SSH logs aren't ours.
		if (extLogs.size === 0) continue;

		addFiles(
			files,
			prefixFiles(
				`vscode-logs/extension/${normalizeZipPath(window.relativePath)}`,
				extLogs,
			),
		);

		const isCurrent = window.windowPath === context.currentWindowPath;
		for (const sshLog of await collectMatchingFiles(
			window.windowPath,
			logger,
			isRemoteSshLog,
		)) {
			const relativePath = normalizeZipPath(
				path.join(window.relativePath, sshLog.relativePath),
			);
			files.set(`vscode-logs/remote-ssh/${relativePath}`, sshLog.data);
			if (isCurrent) {
				currentWindowSshLogs.push({ ...sshLog, relativePath });
			}
		}
	}

	// Current window only: others would mislabel a stale log.
	const activeLog = newestLog(currentWindowSshLogs);
	if (activeLog) {
		files.set(
			`vscode-logs/remote-ssh/${path.basename(activeLog.relativePath)}`,
			activeLog.data,
		);
	}
	return files;
}

// Coder CLI logs: `coder-ssh-*.log` or bare `<pid>.log`.
const isProxyLogFile = (name: string): boolean =>
	isLogFile(name) && (name.startsWith("coder-ssh") || /^\d+\.log$/.test(name));

function isRemoteSshLog(relativePath: string, fileName: string): boolean {
	if (!isLogFile(fileName)) {
		return false;
	}
	const parts = normalizeZipPath(relativePath).split("/");
	// exthost dir is per-extension; output_logging_* is shared.
	if (parts.some(isRemoteSshExtensionDir)) {
		return true;
	}
	return (
		parts.some(isOutputLoggingDir) && isSharedChannelRemoteSshLog(fileName)
	);
}

function newestLog(logs: CollectedFile[]): CollectedFile | undefined {
	let newest: CollectedFile | undefined;
	for (const log of logs) {
		if (
			!newest ||
			log.mtimeMs > newest.mtimeMs ||
			// Locale-stable tie-break (not localeCompare).
			(log.mtimeMs === newest.mtimeMs && log.relativePath > newest.relativePath)
		) {
			newest = log;
		}
	}
	return newest;
}
