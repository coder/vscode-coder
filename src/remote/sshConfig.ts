import {
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { countSubstring, lowercase } from "../util";
import { cleanupFiles } from "../util/fileCleanup";
import { renameWithRetry, tempFilePath } from "../util/fs";

import type { Logger } from "../logging/logger";

class SshConfigBadFormat extends Error {}

interface Block {
	start: number;
	end: number;
}

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

/** Injectable for tests. */
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

/** An SSH config key at the start of a line, e.g. "ConnectTimeout". */
const SSH_KEY_REGEX = /^[a-zA-Z0-9-]+/;

/** The Coder CLI's START-CODER block, flexible on dash count. */
const CODER_BLOCK_REGEX = /^# -+START-CODER-+$(.*?)^# -+END-CODER-+$/ms;

/** Matches a string that is only an SSH config key. */
const KEY_ONLY_REGEX = /^[a-zA-Z0-9-]+$/;

/** Characters that would break a value out of its config line. */
const UNSAFE_CHARS_REGEX = /[\r\n\0]/;

interface BlockMarkers {
	start: string;
	end: string;
}

/** Released versions wrote deployment blocks with these markers into the user's config. */
function legacyDeploymentMarkers(safeHostname: string): BlockMarkers {
	return {
		start: `# --- START CODER VSCODE ${safeHostname} ---`,
		end: `# --- END CODER VSCODE ${safeHostname} ---`,
	};
}

/** Shared include block; identical bytes from every editor, so writers converge. */
const INCLUDE_MARKERS: BlockMarkers = {
	start: "# --- START CODER ---",
	end: "# --- END CODER ---",
};

/** Header of the generated per-deployment file. */
const CODER_SSH_CONFIG_HEADER = `# Coder workspace hosts. Do not edit; the Coder extension rewrites this file
# on every connection. Override options with the "coder.sshConfig" setting.`;

/** Connects rewrite the file, so anything older is unused and safe to sweep. */
const STALE_CONFIG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Delete generated configs (from any editor) not connected to recently. */
export async function cleanupStaleSshConfigs(
	dir: string,
	logger: Logger,
): Promise<void> {
	await cleanupFiles(dir, logger, {
		label: "generated SSH config",
		filter: (name) => name.endsWith(".conf"),
		select: (files, now) =>
			files.filter((file) => now - file.mtime > STALE_CONFIG_MAX_AGE_MS),
	});
}

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
 * Connection-critical options Coder always writes itself, so the error must
 * not suggest overriding them in coder.sshConfig.
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

/** Parse "Key value" or "Key=value" lines, accumulating SetEnv values. */
export function parseSshConfig(lines: string[]): Record<string, string> {
	return lines.reduce(
		(acc, line) => {
			const keyMatch = SSH_KEY_REGEX.exec(line);
			if (!keyMatch) {
				return acc;
			}

			const key = keyMatch[0];
			const separator = line.at(key.length);
			if (separator !== "=" && separator !== " ") {
				return acc;
			}

			const value = line.slice(key.length + 1);

			if (key.toLowerCase() === "setenv") {
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

/** Merge overrides into config; keys match case-insensitively. */
export function mergeSshConfigValues(
	config: Record<string, string>,
	overrides: Record<string, string>,
): Record<string, string> {
	const merged: Record<string, string> = {};

	const caseInsensitiveOverrides: Record<string, string> = {};
	Object.keys(overrides).forEach((key) => {
		caseInsensitiveOverrides[key.toLowerCase()] = key;
	});

	Object.keys(config).forEach((key) => {
		const lower = key.toLowerCase();
		if (caseInsensitiveOverrides[lower]) {
			const correctCaseKey = caseInsensitiveOverrides[lower];
			const value = overrides[correctCaseKey];
			delete caseInsensitiveOverrides[lower];

			// SetEnv concatenates instead of replacing.
			if (lower === "setenv") {
				if (value === "") {
					merged["SetEnv"] = config[key];
				} else {
					merged["SetEnv"] = `${config[key]} ${value}`;
				}
				return;
			}

			// An empty override removes the key.
			if (value !== "") {
				merged[correctCaseKey] = value;
			}

			return;
		}
		if (config[key] !== "") {
			merged[key] = config[key];
		}
	});

	Object.keys(caseInsensitiveOverrides).forEach((lower) => {
		const correctCaseKey = caseInsensitiveOverrides[lower];
		const value = overrides[correctCaseKey];

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
		this.raw = await this.read();
		this.logger.debug("Loaded SSH config", this.filePath);
	}

	/**
	 * Regenerate the whole per-deployment file; last-writer-wins. Always
	 * writes, so the file's mtime marks the last connect for the stale sweep.
	 */
	async update(values: SshValues, overrides?: Record<string, string>) {
		const block = this.renderDeploymentBlock(values, overrides);
		this.raw = `${CODER_SSH_CONFIG_HEADER}\n\n${block}`;
		await this.save();
	}

	/**
	 * Keep the shared include first so our options win, removing superseded
	 * blocks. Read-modify-write with no locking, like the CLI's config-ssh;
	 * when the include is already in place nothing is written.
	 */
	async updateInclude(includeDir: string, safeHostname: string) {
		const block = this.renderIncludeBlock(includeDir);
		const raw = await this.read();
		this.raw = this.mergeInclude(raw, block, safeHostname);
		if (this.raw !== raw) {
			await this.save();
			this.logger.debug("Including SSH config dir", includeDir);
		}
	}

	public getRaw() {
		if (this.raw === undefined) {
			throw new Error("SshConfig is not loaded. Try sshConfig.load()");
		}

		return this.raw;
	}

	/**
	 * Render the deployment's block, validating everything written into it.
	 * @throws {Error} when the values or overrides fail validation.
	 */
	private renderDeploymentBlock(
		values: SshValues,
		overrides?: Record<string, string>,
	): string {
		validateSshConfigOptions({ ...values });
		validateSshConfigOptions(overrides ?? {});
		const { Host, ...defaults } = values;
		const config = mergeSshConfigValues(defaults, overrides ?? {});
		const options = Object.keys(config)
			.sort()
			.filter((key) => config[key] !== "")
			.map((key) => `  ${key} ${config[key]}`);
		return [`Host ${Host}`, ...options].join("\n");
	}

	private findBlock(raw: string, markers: BlockMarkers): Block | undefined {
		const startCount = countSubstring(markers.start, raw);
		const endCount = countSubstring(markers.end, raw);
		if (startCount !== endCount) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has ${startCount} "${markers.start}" and ${endCount} "${markers.end}" markers. Each START marker must have exactly one END marker.`,
			);
		}
		if (startCount > 1) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has ${startCount} "${markers.start}" blocks. Please remove all but one.`,
			);
		}
		if (startCount === 0) {
			return undefined;
		}

		const start = raw.indexOf(markers.start);
		const endMarkerStart = raw.indexOf(markers.end);
		if (endMarkerStart < start) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has an "${markers.end}" marker before its "${markers.start}" marker.`,
			);
		}
		return { start, end: endMarkerStart + markers.end.length };
	}

	private renderIncludeBlock(includeDir: string): string {
		return [
			INCLUDE_MARKERS.start,
			"# Moves back to the top on connect; override options via coder.sshConfig.",
			`Include "${this.escapeIncludePath(includeDir)}/*.conf"`,
			INCLUDE_MARKERS.end,
		].join("\n");
	}

	private escapeIncludePath(includePath: string): string {
		// Emit ~/... so home-path quirks (spaces, %, glob chars) never reach ssh.
		const relative = path.relative(os.homedir(), includePath);
		const argument =
			relative && !relative.startsWith("..") && !path.isAbsolute(relative)
				? `~/${relative}`
				: includePath;
		// No escape exists for '"' in quoted arguments; OpenSSH 9.9+ fatals on
		// unknown %-tokens in Include arguments.
		if (/[\r\n\0"%]/.test(argument)) {
			throw new Error(
				"SSH include path must not contain CR, LF, NUL, %, or double-quote characters.",
			);
		}
		return argument.replaceAll("\\", "/").replace(/[*?[\]]/g, "\\$&");
	}

	private mergeInclude(
		raw: string,
		includeBlock: string,
		safeHostname: string,
	): string {
		let rest = raw;
		const superseded = [INCLUDE_MARKERS, legacyDeploymentMarkers(safeHostname)];
		for (const markers of superseded) {
			const block = this.findBlock(rest, markers);
			if (block) {
				rest = this.removeRange(rest, block);
			}
		}
		return [includeBlock, rest].filter(Boolean).join("\n\n");
	}

	private removeRange(raw: string, range: Block): string {
		const before = raw.slice(0, range.start).trimEnd();
		const after = raw.slice(range.end).trimStart();
		return [before, after].filter(Boolean).join("\n\n");
	}

	/** Atomically write raw via a temp file. */
	private async save(): Promise<void> {
		// Preserve the existing file mode.
		const existingMode = await this.fileSystem
			.stat(this.filePath)
			.then((stat) => stat.mode)
			.catch((ex: NodeJS.ErrnoException) => {
				if (ex.code === "ENOENT") {
					return 0o600;
				}
				throw ex;
			});
		await this.fileSystem.mkdir(path.dirname(this.filePath), {
			mode: 0o700,
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
			await this.discardTemp(tempPath);
			throw new Error(
				`Failed to rename temporary SSH config file at ${tempPath} to ${this.filePath}: ${
					err instanceof Error ? err.message : String(err)
				}. Please check your disk space, permissions, and that the directory exists.`,
				{ cause: err },
			);
		}
	}

	private async discardTemp(tempPath: string): Promise<void> {
		await this.fileSystem.unlink(tempPath).catch((unlinkErr: unknown) => {
			this.logger.warn(
				"Failed to clean up temp SSH config file",
				tempPath,
				unlinkErr,
			);
		});
	}

	private async read(): Promise<string> {
		try {
			return await this.fileSystem.readFile(this.filePath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return "";
			}
			throw error;
		}
	}
}
