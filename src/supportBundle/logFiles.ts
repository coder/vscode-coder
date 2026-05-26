import { type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { type Logger } from "../logging/logger";
import { REMOTE_SSH_EXTENSION_IDS } from "../remote/sshExtension";

import {
	addFiles,
	collectDirFiles,
	collectMatchingFiles,
	type CollectedFile,
	isLogFile,
	normalizeZipPath,
	prefixFiles,
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

// Coder CLI writes either `coder-ssh-*.log` or bare `<pid>.log`.
const isProxyLogFile = (name: string): boolean =>
	isLogFile(name) && (name.startsWith("coder-ssh") || /^\d+\.log$/.test(name));

function isRemoteSshLog(relativePath: string, fileName: string): boolean {
	if (!isLogFile(fileName)) {
		return false;
	}
	const parts = normalizeZipPath(relativePath).split("/");
	// Whole exthost dir belongs to one extension; output_logging_* is shared.
	if (
		parts.some((part) =>
			(REMOTE_SSH_EXTENSION_IDS as readonly string[]).includes(part),
		)
	) {
		return true;
	}
	return (
		parts.some((part) => part.startsWith("output_logging_")) &&
		fileName.includes("Remote - SSH")
	);
}

function newestLog(logs: CollectedFile[]): CollectedFile | undefined {
	// Lexicographic tie-break (not localeCompare) so the choice is locale-stable.
	return logs.toSorted((a, b) => {
		if (b.mtimeMs !== a.mtimeMs) {
			return b.mtimeMs - a.mtimeMs;
		}
		if (b.relativePath === a.relativePath) {
			return 0;
		}
		return b.relativePath > a.relativePath ? 1 : -1;
	})[0];
}

export function resolveLogContext(
	extensionLogDir: string,
): LogContext | undefined {
	const resolved = path.resolve(extensionLogDir);
	const exthostDir = path.dirname(resolved);
	const windowDir = path.dirname(exthostDir);
	const windowName = path.basename(windowDir);
	const sessionDir = path.dirname(windowDir);

	// Trust the layout, not the literal id: forks may rebrand the id.
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

async function readWindowDir(
	dirPath: string,
	logger: Logger,
): Promise<Dirent[]> {
	try {
		return await fs.readdir(dirPath, { withFileTypes: true });
	} catch (error) {
		logger.warn(`Could not read log directory ${dirPath}`, error);
		return [];
	}
}

export async function collectWindowLogDirs(
	logsRoot: string,
	logger: Logger,
): Promise<WindowLogDir[]> {
	const windows: WindowLogDir[] = [];
	await Promise.all(
		(await readWindowDir(logsRoot, logger)).map(async (entry) => {
			if (!entry.isDirectory()) return;
			const entryPath = path.join(logsRoot, entry.name);
			if (/^window\d+$/i.test(entry.name)) {
				windows.push({ relativePath: entry.name, windowPath: entryPath });
				return;
			}
			for (const sub of await readWindowDir(entryPath, logger)) {
				if (sub.isDirectory() && /^window\d+$/i.test(sub.name)) {
					windows.push({
						relativePath: `${entry.name}/${sub.name}`,
						windowPath: path.join(entryPath, sub.name),
					});
				}
			}
		}),
	);
	return windows.sort((a, b) => (a.relativePath > b.relativePath ? 1 : -1));
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
		try {
			files.set(
				`vscode-logs/proxy/${activeBasename}`,
				await fs.readFile(sources.activeProxyLogPath),
			);
		} catch (error) {
			logger.warn("Could not read active Coder SSH proxy log", error);
		}
	}

	if (sources.proxyLogDir) {
		addFiles(
			files,
			prefixFiles(
				"vscode-logs/proxy",
				// Active log was already added above; don't double-bundle.
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
		// Non-canonical layout: scan the extension dir + assumed window dir
		// (one level up, or two if the parent is `exthost`).
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
		// Skip windows that never hosted Coder; their SSH logs aren't ours.
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

	// Current window only; falling back to others would mislabel a stale log.
	const activeLog = newestLog(currentWindowSshLogs);
	if (activeLog) {
		files.set(
			`vscode-logs/remote-ssh/${path.basename(activeLog.relativePath)}`,
			activeLog.data,
		);
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
