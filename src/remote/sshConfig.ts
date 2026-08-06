import {
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

import { countSubstring, lowercase } from "../util";
import { renameWithRetry, tempFilePath } from "../util/fs";

import type { Logger } from "../logging/logger";

export interface SshValues {
	Host: string;
	ProxyCommand: string;
	ConnectTimeout: string;
	StrictHostKeyChecking: string;
	UserKnownHostsFile: string;
	LogLevel: string;
	ServerAliveInterval: string;
	ServerAliveCountMax: string;
	SetEnv?: string;
}

/** Interface for the file system to make it easier to test. */
export interface FileSystem {
	mkdir: typeof mkdir;
	readFile: typeof readFile;
	rename: typeof rename;
	stat: typeof stat;
	unlink: typeof unlink;
	writeFile: typeof writeFile;
}

const defaultFileSystem: FileSystem = {
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
};

class SshConfigBadFormat extends Error {}

interface Block {
	raw: string;
}

/** Matches an SSH config key at the start of a line (e.g. "ConnectTimeout", "LogLevel"). */
const SSH_KEY_REGEX = /^[a-zA-Z0-9-]+/;

/** Matches the Coder CLI's START-CODER / END-CODER block, flexible on dash count. */
const CODER_BLOCK_REGEX = /^# -+START-CODER-+$(.*?)^# -+END-CODER-+$/ms;

/** Matches a string that is only an SSH config key. */
const KEY_ONLY_REGEX = /^[a-zA-Z0-9-]+$/;

/** Characters that would break a value out of its config line. */
const UNSAFE_CHARS_REGEX = /[\r\n\0]/;

/**
 * SSH options a deployment may not set, mirroring the server's validation of
 * --ssh-config-options (codersdk.ValidateSSHConfigOption).
 */
const DENIED_DEPLOYMENT_KEYS: ReadonlySet<Lowercase<string>> = new Set([
	// Structural directives that escape Coder's managed block.
	"host",
	"match",
	"include",
	// Directives that run an attacker-supplied command string.
	"proxycommand",
	"localcommand",
	"permitlocalcommand",
	"remotecommand",
	"knownhostscommand",
	// Directives that load an attacker-controlled shared library.
	"pkcs11provider",
	"securitykeyprovider",
	"smartcarddevice",
	// Directives that execute a command for X11 authentication.
	"xauthlocation",
	// Conflicts with Coder's managed ProxyCommand.
	"proxyjump",
]);

/**
 * Options the post-write check in remote.ts pins to Coder's own value. Setting
 * these in coder.sshConfig fails that check, so the error must not suggest it.
 */
const PINNED_KEYS: ReadonlySet<Lowercase<string>> = new Set([
	"proxycommand",
	"userknownhostsfile",
	"stricthostkeychecking",
]);

/**
 * Validate SSH options sent by the Coder deployment. Keys in `userOverrides`
 * are exempt from the deny list: the user's value wins the merge, so the
 * deployment's value is never written.
 * @throws {Error} when an option is malformed or denied.
 */
export function validateDeploymentSshOptions(
	options: Record<string, unknown>,
	userOverrides: Record<string, string>,
): Record<string, string> {
	validateSshConfigOptions(options);
	const overridden = new Set(Object.keys(userOverrides).map(lowercase));
	const denied = Object.keys(options).filter((key) => {
		const lower = lowercase(key);
		return DENIED_DEPLOYMENT_KEYS.has(lower) && !overridden.has(lower);
	});
	if (denied.length > 0) {
		const quote = (keys: string[]) =>
			keys.map((key) => JSON.stringify(key)).join(", ");
		const pinned = denied.filter((key) => PINNED_KEYS.has(lowercase(key)));
		const overridable = denied.filter((key) => !pinned.includes(key));
		let message = `The Coder deployment tried to set SSH options that could run code or change how Coder connects: ${quote(denied)}.`;
		if (overridable.length > 0) {
			message += ` To allow ${quote(overridable)}, set the option yourself in the "coder.sshConfig" setting, which overrides the deployment.`;
		}
		if (pinned.length > 0) {
			message += ` Coder manages ${quote(pinned)}, which cannot be overridden.`;
		}
		throw new Error(message);
	}
	return options;
}

/** Validate the key and value of every option in the record. */
function validateSshConfigOptions(
	options: Record<string, unknown>,
): asserts options is Record<string, string> {
	for (const [key, value] of Object.entries(options)) {
		if (!KEY_ONLY_REGEX.test(key)) {
			throw new Error(
				`SSH config option key ${JSON.stringify(key)} is invalid`,
			);
		}
		validateSshValue(`option ${JSON.stringify(key)}`, value);
	}
}

/** Check that the value is a string and cannot break out of its config line. */
function validateSshValue(
	name: string,
	value: unknown,
): asserts value is string {
	if (typeof value !== "string") {
		throw new Error(`SSH config ${name} must be a string`);
	}
	if (UNSAFE_CHARS_REGEX.test(value)) {
		throw new Error(
			`SSH config ${name} must not contain carriage return, newline, or NUL characters`,
		);
	}
}

/**
 * Extract `# :ssh-option=` values from the Coder CLI's config block, or `{}`
 * if there is none. These are flags the user passed to `coder config-ssh`.
 */
export function parseCoderSshOptions(raw: string): Record<string, string> {
	const blockMatch = CODER_BLOCK_REGEX.exec(raw);
	const block = blockMatch?.[1];
	if (!block) {
		return {};
	}
	const prefix = "# :ssh-option=";
	const sshOptionLines = block
		.split(/\r?\n/)
		.filter((line) => line.startsWith(prefix))
		.map((line) => line.slice(prefix.length));

	return parseSshConfig(sshOptionLines);
}

/**
 * Parse an array of SSH config lines into a Record.
 * Handles both "Key value" and "Key=value" formats.
 * Accumulates SetEnv values since SSH allows multiple environment variables.
 */
export function parseSshConfig(lines: string[]): Record<string, string> {
	return lines.reduce(
		(acc, line) => {
			const keyMatch = SSH_KEY_REGEX.exec(line);
			if (!keyMatch) {
				return acc; // Malformed line
			}

			const key = keyMatch[0];
			const separator = line.at(key.length);
			if (separator !== "=" && separator !== " ") {
				return acc; // Malformed line
			}

			const value = line.slice(key.length + 1);

			// Accumulate SetEnv values since there can be multiple.
			if (key.toLowerCase() === "setenv") {
				// Ignore empty SetEnv values
				if (value !== "") {
					const existing = acc["SetEnv"];
					acc["SetEnv"] = existing ? `${existing} ${value}` : value;
				}
			} else {
				acc[key] = value;
			}
			return acc;
		},
		{} as Record<string, string>,
	);
}

/**
 * Merge the given SSH config with the provided overrides. The merge handles
 * key case insensitivity, so casing in the key does not matter.
 */
export function mergeSshConfigValues(
	config: Record<string, string>,
	overrides: Record<string, string>,
): Record<string, string> {
	const merged: Record<string, string> = {};

	// We need to do a case insensitive match for the overrides as ssh config keys are case insensitive.
	// To get the correct key:value, use:
	//   key = caseInsensitiveOverrides[key.toLowerCase()]
	//   value = overrides[key]
	const caseInsensitiveOverrides: Record<string, string> = {};
	Object.keys(overrides).forEach((key) => {
		caseInsensitiveOverrides[key.toLowerCase()] = key;
	});

	Object.keys(config).forEach((key) => {
		const lower = key.toLowerCase();
		// If the key is in overrides, use the override value.
		if (caseInsensitiveOverrides[lower]) {
			const correctCaseKey = caseInsensitiveOverrides[lower];
			const value = overrides[correctCaseKey];
			delete caseInsensitiveOverrides[lower];

			// Special handling for SetEnv - concatenate values instead of replacing.
			if (lower === "setenv") {
				if (value === "") {
					merged["SetEnv"] = config[key];
				} else {
					merged["SetEnv"] = `${config[key]} ${value}`;
				}
				return;
			}

			// If the value is empty, do not add the key. It is being removed.
			if (value !== "") {
				merged[correctCaseKey] = value;
			}

			return;
		}
		// If no override, take the original value.
		if (config[key] !== "") {
			merged[key] = config[key];
		}
	});

	// Add remaining overrides.
	Object.keys(caseInsensitiveOverrides).forEach((lower) => {
		const correctCaseKey = caseInsensitiveOverrides[lower];
		const value = overrides[correctCaseKey];

		// Special handling for SetEnv - concatenate if already exists
		if (lower === "setenv" && merged["SetEnv"]) {
			merged["SetEnv"] = `${merged["SetEnv"]} ${value}`;
		} else {
			merged[correctCaseKey] = value;
		}
	});

	return merged;
}

export class SshConfig {
	private readonly filePath: string;
	private readonly fileSystem: FileSystem;
	private readonly logger: Logger;
	private raw: string | undefined;

	private startBlockComment(safeHostname: string): string {
		return `# --- START CODER VSCODE ${safeHostname} ---`;
	}
	private endBlockComment(safeHostname: string): string {
		return `# --- END CODER VSCODE ${safeHostname} ---`;
	}

	constructor(
		filePath: string,
		logger: Logger,
		fileSystem: FileSystem = defaultFileSystem,
	) {
		this.filePath = filePath;
		this.logger = logger;
		this.fileSystem = fileSystem;
	}

	async load() {
		try {
			this.raw = await this.fileSystem.readFile(this.filePath, "utf-8");
			this.logger.debug("Loaded SSH config", this.filePath);
		} catch {
			this.logger.debug(
				"SSH config file not found, starting fresh",
				this.filePath,
			);
			this.raw = "";
		}
	}

	/**
	 * Update the block for the deployment with the provided hostname.
	 * @throws {Error} when the hostname, values, or overrides fail validation.
	 */
	async update(
		safeHostname: string,
		values: SshValues,
		overrides?: Record<string, string>,
	) {
		const newBlock = this.buildBlock(safeHostname, values, overrides);
		const block = this.getBlock(safeHostname);
		if (block) {
			this.logger.debug("Replacing SSH config block", safeHostname);
			this.replaceBlock(block, newBlock);
		} else {
			this.logger.debug("Appending new SSH config block", safeHostname);
			this.appendBlock(newBlock);
		}
		await this.save();
	}

	/**
	 * Get the block for the deployment with the provided hostname.
	 */
	private getBlock(safeHostname: string): Block | undefined {
		const raw = this.getRaw();
		const startBlock = this.startBlockComment(safeHostname);
		const endBlock = this.endBlockComment(safeHostname);

		const startBlockCount = countSubstring(startBlock, raw);
		const endBlockCount = countSubstring(endBlock, raw);
		if (startBlockCount !== endBlockCount) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has an unterminated START CODER VSCODE ${safeHostname} block. Each START block must have an END block.`,
			);
		}

		if (startBlockCount > 1 || endBlockCount > 1) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has ${startBlockCount} START CODER VSCODE ${safeHostname} sections. Please remove all but one.`,
			);
		}

		const startBlockIndex = raw.indexOf(startBlock);
		const endBlockIndex = raw.indexOf(endBlock);
		const hasBlock = startBlockIndex > -1 && endBlockIndex > -1;
		if (!hasBlock) {
			return;
		}

		if (startBlockIndex === -1) {
			throw new SshConfigBadFormat("Start block not found");
		}

		if (startBlockIndex === -1) {
			throw new SshConfigBadFormat("End block not found");
		}

		if (endBlockIndex < startBlockIndex) {
			throw new SshConfigBadFormat(
				"Malformed config, end block is before start block",
			);
		}

		return {
			raw: raw.substring(startBlockIndex, endBlockIndex + endBlock.length),
		};
	}

	/**
	 * buildBlock builds the ssh config block for the provided URL. The order of
	 * the keys is determinstic based on the input.  Expected values are always in
	 * a consistent order followed by any additional overrides in sorted order.
	 *
	 * Validates everything written here, including the hostname, which lands in
	 * the block marker comments.
	 *
	 * @param safeHostname - The hostname for the deployment.
	 * @param values       - The expected SSH values for using ssh with Coder.
	 * @param overrides    - Overrides typically come from the deployment api and are
	 *                       used to override the default values.  The overrides are
	 *                       given as key:value pairs where the key is the ssh config
	 *                       file key.  If the key matches an expected value, the
	 *                       expected value is overridden. If it does not match an
	 *                       expected value, it is appended to the end of the block.
	 */
	private buildBlock(
		safeHostname: string,
		values: SshValues,
		overrides?: Record<string, string>,
	) {
		validateSshValue("deployment hostname", safeHostname);
		validateSshConfigOptions({ ...values });
		validateSshConfigOptions(overrides ?? {});
		const { Host, ...otherValues } = values;
		const lines = [
			this.startBlockComment(safeHostname),
			"# This section is managed by the Coder VS Code extension.",
			"# Changes will be overwritten on the next workspace connection.",
			`Host ${Host}`,
		];

		// configValues is the merged values of the defaults and the overrides.
		const configValues = mergeSshConfigValues(otherValues, overrides ?? {});

		// keys is the sorted keys of the merged values.
		const keys = Object.keys(configValues).sort();
		keys.forEach((key) => {
			const value = configValues[key];
			if (value !== "") {
				lines.push(this.withIndentation(`${key} ${value}`));
			}
		});

		lines.push(this.endBlockComment(safeHostname));
		return {
			raw: lines.join("\n"),
		};
	}

	private replaceBlock(oldBlock: Block, newBlock: Block) {
		// A replacer function inserts $ sequences literally.
		this.raw = this.getRaw().replace(oldBlock.raw, () => newBlock.raw);
	}

	private appendBlock(block: Block) {
		const raw = this.getRaw();

		if (this.raw === "") {
			this.raw = block.raw;
		} else {
			this.raw = `${raw.trimEnd()}\n\n${block.raw}`;
		}
	}

	private withIndentation(text: string) {
		return `  ${text}`;
	}

	private async save() {
		// We want to preserve the original file mode.
		const existingMode = await this.fileSystem
			.stat(this.filePath)
			.then((stat) => stat.mode)
			.catch((ex: NodeJS.ErrnoException) => {
				if (ex.code === "ENOENT") {
					return 0o600; // default to 0600 if file does not exist
				}
				throw ex; // Any other error is unexpected
			});
		await this.fileSystem.mkdir(path.dirname(this.filePath), {
			mode: 0o700, // only owner has rwx permission, not group or everyone.
			recursive: true,
		});
		const fileName = path.basename(this.filePath);
		const dirName = path.dirname(this.filePath);
		const tempPath = tempFilePath(
			`${dirName}/.${fileName}`,
			"vscode-coder-tmp",
		);
		try {
			await this.fileSystem.writeFile(tempPath, this.getRaw(), {
				mode: existingMode,
				encoding: "utf-8",
			});
		} catch (err) {
			throw new Error(
				`Failed to write temporary SSH config file at ${tempPath}: ${err instanceof Error ? err.message : String(err)}. ` +
					`Please check your disk space, permissions, and that the directory exists.`,
				{ cause: err },
			);
		}

		try {
			await renameWithRetry(
				(src, dest) => this.fileSystem.rename(src, dest),
				tempPath,
				this.filePath,
			);
			this.logger.debug("Saved SSH config", this.filePath);
		} catch (err) {
			await this.fileSystem.unlink(tempPath).catch((unlinkErr: unknown) => {
				this.logger.warn(
					"Failed to clean up temp SSH config file",
					tempPath,
					unlinkErr,
				);
			});
			throw new Error(
				`Failed to rename temporary SSH config file at ${tempPath} to ${this.filePath}: ${
					err instanceof Error ? err.message : String(err)
				}. Please check your disk space, permissions, and that the directory exists.`,
				{ cause: err },
			);
		}
	}

	public getRaw() {
		if (this.raw === undefined) {
			throw new Error("SshConfig is not loaded. Try sshConfig.load()");
		}

		return this.raw;
	}
}
