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
import { collectWindowLogDirs, resolveLogContext } from "./vscodeLogs";

export interface LogSources {
	activeProxyLogPath?: string;
	proxyLogDir?: string;
	extensionLogDir?: string;
}

const isProxyLogFile = (name: string): boolean =>
	name.startsWith("coder-ssh") && isLogFile(name);

async function collectCurrentExtensionLogs(
	extensionLogDir: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	return prefixFiles(
		"vscode-logs/extension",
		await collectDirFiles(extensionLogDir, logger, isLogFile),
	);
}

async function collectWindowExtensionLogs(
	windowPath: string,
	windowRelativePath: string,
	extensionId: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	return prefixFiles(
		`vscode-logs/extension/${normalizeZipPath(windowRelativePath)}`,
		await collectDirFiles(
			path.join(windowPath, "exthost", extensionId),
			logger,
			isLogFile,
			false,
		),
	);
}

async function collectExtensionLogs(
	extensionLogDir: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const context = resolveLogContext(extensionLogDir);
	if (!context) {
		return collectCurrentExtensionLogs(extensionLogDir, logger);
	}

	const files = new Map<string, Uint8Array>();
	const extensionId = path.basename(extensionLogDir);
	for (const windowLogDir of await collectWindowLogDirs(
		context.logsRoot,
		logger,
	)) {
		addFiles(
			files,
			await collectWindowExtensionLogs(
				windowLogDir.windowPath,
				windowLogDir.relativePath,
				extensionId,
				logger,
			),
		);
	}

	return files.size > 0
		? files
		: collectCurrentExtensionLogs(extensionLogDir, logger);
}

function isRemoteSshLog(relativePath: string, fileName: string): boolean {
	if (!fileName.includes("Remote - SSH") || !isLogFile(fileName)) {
		return false;
	}

	const parts = normalizeZipPath(relativePath).split("/");
	return parts.some(
		(part) =>
			part.startsWith("output_logging_") ||
			(REMOTE_SSH_EXTENSION_IDS as readonly string[]).includes(part),
	);
}

function newestLog(logs: CollectedFile[]): CollectedFile | undefined {
	return logs.toSorted(
		(a, b) =>
			b.mtimeMs - a.mtimeMs || b.relativePath.localeCompare(a.relativePath),
	)[0];
}

async function collectRemoteSshLogs(
	extensionLogDir: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const context = resolveLogContext(extensionLogDir);
	const files = new Map<string, Uint8Array>();
	if (!context) {
		return files;
	}

	const remoteSshLogs: CollectedFile[] = [];
	const extensionId = path.basename(extensionLogDir);
	for (const windowLogDir of await collectWindowLogDirs(
		context.logsRoot,
		logger,
	)) {
		if (
			(
				await collectWindowExtensionLogs(
					windowLogDir.windowPath,
					windowLogDir.relativePath,
					extensionId,
					logger,
				)
			).size === 0
		) {
			continue;
		}

		for (const logFile of await collectMatchingFiles(
			windowLogDir.windowPath,
			logger,
			isRemoteSshLog,
		)) {
			const relativePath = normalizeZipPath(
				path.join(windowLogDir.relativePath, logFile.relativePath),
			);
			remoteSshLogs.push({ ...logFile, relativePath });
			files.set(`vscode-logs/remote-ssh/${relativePath}`, logFile.data);
		}
	}

	const currentWindowRelativePath = normalizeZipPath(
		path.relative(context.logsRoot, context.currentWindowPath),
	);
	const currentWindowLogs = remoteSshLogs.filter((logFile) =>
		logFile.relativePath.startsWith(`${currentWindowRelativePath}/`),
	);
	const activeLog = newestLog(
		currentWindowLogs.length > 0 ? currentWindowLogs : remoteSshLogs,
	);
	if (activeLog) {
		files.set(
			`vscode-logs/remote-ssh/${path.basename(activeLog.relativePath)}`,
			activeLog.data,
		);
	}

	return files;
}

async function collectProxyLogs(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();

	if (sources.activeProxyLogPath) {
		try {
			files.set(
				"vscode-logs/proxy/active.log",
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
				await collectDirFiles(sources.proxyLogDir, logger, isProxyLogFile),
			),
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
			await collectExtensionLogs(sources.extensionLogDir, logger),
		);
		addFiles(
			files,
			await collectRemoteSshLogs(sources.extensionLogDir, logger),
		);
	}

	return files;
}
