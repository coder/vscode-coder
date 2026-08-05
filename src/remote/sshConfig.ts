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
import { renameWithRetry, tempFilePath } from "../util/fs";

import type { Logger } from "../logging/logger";

class SshConfigBadFormat extends Error {}

interface Block {
	raw: string;
	start: number;
	end: number;
}

interface Mutation {
	apply(raw: string): string;
	onSuccess?(): void;
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

/** Matches an SSH config key at the start of a line (e.g. "ConnectTimeout", "LogLevel"). */
const SSH_KEY_REGEX = /^[a-zA-Z0-9-]+/;

/** Matches the Coder CLI's START-CODER / END-CODER block, flexible on dash count. */
const CODER_BLOCK_REGEX = /^# -+START-CODER-+$(.*?)^# -+END-CODER-+$/ms;

/** Matches a string that is only an SSH config key. */
const KEY_ONLY_REGEX = /^[a-zA-Z0-9-]+$/;

/** Characters that would break a value out of its config line. */
const UNSAFE_CHARS_REGEX = /[\r\n\0]/;

const UPDATE_ATTEMPTS = 3;

interface BlockMarkers {
	start: string;
	end: string;
}

// Labels are an editor ID for include blocks in the user's config and a
// deployment hostname for blocks in the editor-owned generated file.
function blockMarkers(label: string): BlockMarkers {
	return {
		start: `# --- START CODER ${label} ---`,
		end: `# --- END CODER ${label} ---`,
	};
}

// Released versions wrote deployment blocks with this label into the user's config.
function legacyDeploymentMarkers(safeHostname: string): BlockMarkers {
	return blockMarkers(`VSCODE ${safeHostname}`);
}

// Kept at the top of the editor-owned generated file.
const CODER_SSH_CONFIG_HEADER = `# Coder workspace hosts. Do not edit; the Coder extension rewrites this file
# on every connection. Override options with the "coder.sshConfig" setting.`;

export interface SshInclude {
	id: string;
	includePath: string;
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
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
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
		const block = this.renderDeploymentBlock(safeHostname, values, overrides);
		await this.mutate({
			apply: (raw) => this.mergeDeployment(raw, safeHostname, block),
		});
	}

	/** Include an editor's config first so its options win, removing its deployment block. */
	async updateInclude(include: SshInclude, safeHostname: string) {
		const block = this.renderIncludeBlock(include);
		await this.mutate({
			apply: (raw) => this.mergeInclude(raw, include.id, block, safeHostname),
			onSuccess: () =>
				this.logger.debug("Including SSH config", include.includePath),
		});
	}

	public getRaw() {
		if (this.raw === undefined) {
			throw new Error("SshConfig is not loaded. Try sshConfig.load()");
		}

		return this.raw;
	}

	/**
	 * Render the deployment's block, validating everything written into it,
	 * including the hostname, which lands in the block marker comments.
	 * @throws {Error} when the hostname, values, or overrides fail validation.
	 */
	private renderDeploymentBlock(
		safeHostname: string,
		values: SshValues,
		overrides?: Record<string, string>,
	): string {
		validateSshValue("deployment hostname", safeHostname);
		validateSshConfigOptions({ ...values });
		validateSshConfigOptions(overrides ?? {});
		const { Host, ...defaults } = values;
		const config = mergeSshConfigValues(defaults, overrides ?? {});
		const options = Object.keys(config)
			.sort()
			.filter((key) => config[key] !== "")
			.map((key) => `  ${key} ${config[key]}`);
		const markers = blockMarkers(safeHostname);
		return [markers.start, `Host ${Host}`, ...options, markers.end].join("\n");
	}

	private mergeDeployment(
		raw: string,
		safeHostname: string,
		block: string,
	): string {
		let merged: string;
		const existing = this.findBlock(raw, blockMarkers(safeHostname));
		if (existing) {
			this.logger.debug("Replacing SSH config block", safeHostname);
			merged = this.replaceRange(raw, existing, block);
		} else {
			this.logger.debug("Appending new SSH config block", safeHostname);
			merged = raw ? `${raw.trimEnd()}\n\n${block}` : block;
		}
		return this.moveHeaderToTop(merged);
	}

	/** The user may have added content above the header; move it back to the top. */
	private moveHeaderToTop(merged: string): string {
		const start = merged.indexOf(CODER_SSH_CONFIG_HEADER);
		if (start === 0) {
			return merged;
		}
		if (start > 0) {
			merged = this.removeRange(merged, {
				raw: CODER_SSH_CONFIG_HEADER,
				start,
				end: start + CODER_SSH_CONFIG_HEADER.length,
			});
		}
		return `${CODER_SSH_CONFIG_HEADER}\n\n${merged}`;
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

		const start = raw.indexOf(markers.start);
		const endMarkerStart = raw.indexOf(markers.end);
		if (start === -1 || endMarkerStart === -1) return undefined;
		if (endMarkerStart < start) {
			throw new SshConfigBadFormat(
				`Malformed config: ${this.filePath} has an "${markers.end}" marker before its "${markers.start}" marker.`,
			);
		}
		const end = endMarkerStart + markers.end.length;
		return { raw: raw.slice(start, end), start, end };
	}

	private replaceRange(raw: string, range: Block, replacement: string): string {
		return raw.slice(0, range.start) + replacement + raw.slice(range.end);
	}

	private renderIncludeBlock({ id, includePath }: SshInclude): string {
		if (id.length === 0) {
			throw new Error("Editor ID must not be empty.");
		}
		const markers = blockMarkers(id);
		return [
			markers.start,
			"# Moves back to the top on connect; override options via coder.sshConfig.",
			`Include "${this.escapeIncludePath(includePath)}"`,
			markers.end,
		].join("\n");
	}

	private escapeIncludePath(includePath: string): string {
		// Prefer ~/... so quirks in the home path (spaces, %, glob characters)
		// never reach the emitted argument. ssh expands the tilde itself.
		const relative = path.relative(os.homedir(), includePath);
		const argument =
			relative && !relative.startsWith("..") && !path.isAbsolute(relative)
				? `~/${relative}`
				: includePath;
		// ssh_config has no escape for '"' inside a quoted argument, and
		// OpenSSH 9.9+ fatals on unknown %-tokens in Include arguments.
		if (/[\r\n\0"%]/.test(argument)) {
			throw new Error(
				"SSH include path must not contain CR, LF, NUL, %, or double-quote characters.",
			);
		}
		return argument.replaceAll("\\", "/").replace(/[*?[\]]/g, "\\$&");
	}

	private mergeInclude(
		raw: string,
		editorId: string,
		includeBlock: string,
		safeHostname: string,
	): string {
		let rest = raw;
		const editorBlock = this.findBlock(rest, blockMarkers(editorId));
		if (editorBlock) {
			rest = this.removeRange(rest, editorBlock);
		}
		const deployment = this.findBlock(
			rest,
			legacyDeploymentMarkers(safeHostname),
		);
		if (deployment) {
			this.logger.debug("Removing superseded SSH config block", safeHostname);
			rest = this.removeRange(rest, deployment);
		}
		return [includeBlock, rest].filter(Boolean).join("\n\n");
	}

	private removeRange(raw: string, range: Block): string {
		const before = raw.slice(0, range.start).trimEnd();
		const after = raw.slice(range.end).trimStart();
		return [before, after].filter(Boolean).join("\n\n");
	}

	private async mutate(mutation: Mutation): Promise<void> {
		let snapshot = this.getRaw();
		// Retries only handle concurrent writers (save() returns false on a
		// conflict); I/O errors like EACCES throw immediately and are not retried.
		for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt++) {
			const updated = mutation.apply(snapshot);
			if (updated === snapshot) {
				this.raw = snapshot;
				return;
			}

			this.raw = updated;
			if (!(await this.save(snapshot))) {
				snapshot = await this.read();
				continue;
			}

			const latest = await this.read();
			if (mutation.apply(latest) === latest) {
				this.raw = latest;
				mutation.onSuccess?.();
				return;
			}
			snapshot = latest;
		}

		this.raw = snapshot;
		throw new Error(
			`Failed to update SSH config at ${this.filePath} because it kept changing, likely due to another editor writing it at the same time. Please try again.`,
		);
	}

	private async save(expectedRaw?: string): Promise<boolean> {
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
			if (expectedRaw !== undefined) {
				const latest = await this.read();
				if (latest !== expectedRaw) {
					await this.fileSystem.unlink(tempPath).catch((unlinkErr: unknown) => {
						this.logger.warn(
							"Failed to clean up conflicted temp SSH config file",
							tempPath,
							unlinkErr,
						);
					});
					return false;
				}
			}
			await renameWithRetry(
				(src, dest) => this.fileSystem.rename(src, dest),
				tempPath,
				this.filePath,
			);
			this.logger.debug("Saved SSH config", this.filePath);
			return true;
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
