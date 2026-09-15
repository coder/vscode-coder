import path from "node:path";

import { SSH_CONFIG_EXT } from "../core/pathResolver";

import { SshConfig, type FileSystem } from "./sshConfig";
import { WindowsAcl } from "./windowsAcl";

import type { Logger } from "../logging/logger";

export function createManagedSshConfig(
	filePath: string,
	logger: Logger,
	scriptPath: string,
): SshConfig {
	if (process.platform !== "win32") {
		return new SshConfig(filePath, logger);
	}
	return new ManagedSshConfig(filePath, logger, new WindowsAcl(scriptPath));
}

/** Repairs permissions on Coder-managed SSH config files before each write. */
export class ManagedSshConfig extends SshConfig {
	constructor(
		filePath: string,
		logger: Logger,
		private readonly windowsAcl: WindowsAcl,
		fileSystem?: FileSystem,
	) {
		super(filePath, logger, fileSystem);
	}

	protected override async prepareWrite(dirName: string): Promise<void> {
		try {
			const entries = await this.fileSystem.readdir(dirName, {
				withFileTypes: true,
			});
			for (const entry of entries) {
				if (!entry.name.toLowerCase().endsWith(SSH_CONFIG_EXT)) {
					continue;
				}

				const filePath = path.join(dirName, entry.name);
				if (!entry.isFile()) {
					this.logger.warn(
						"Skipping non-regular Coder-managed SSH config entry",
						filePath,
					);
					continue;
				}
				await this.repair(filePath);
			}
		} catch (error) {
			this.logger.warn(
				"Failed to enumerate Coder-managed SSH config files",
				error,
			);
		}
	}

	protected override async secureTemp(tempPath: string): Promise<void> {
		await this.repair(tempPath);
	}

	private async repair(filePath: string): Promise<void> {
		try {
			await this.windowsAcl.secure(filePath);
		} catch (error) {
			this.logger.warn(
				"Failed to repair SSH config permissions",
				filePath,
				error,
			);
		}
	}
}
