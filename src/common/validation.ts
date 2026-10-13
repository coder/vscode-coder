import { isIP } from "node:net";
import os from "node:os";

const OMITTED_URL =
	"[URL omitted to protect credentials and other sensitive parameters]";

/** A safe display message with a bounded diagnostic value for Coder Output. */
export class InputValidationError extends Error {
	readonly diagnosticValue: string;

	constructor(message: string, value: string) {
		super(message);
		this.name = "InputValidationError";
		this.diagnosticValue = JSON.stringify(value.slice(0, 512));
	}
}

export function parseDeploymentUrl(value: string): URL {
	try {
		return new URL(value);
	} catch {
		throw new InputValidationError(
			"Invalid URL: the deployment URL is not a valid address.",
			OMITTED_URL,
		);
	}
}

/** User and workspace names, excluding the remote-authority separators. */
export function isValidIdentifier(value: string): boolean {
	return /^\w+(?:-\w+)*$/.test(value);
}

export function validateIdentifier(
	value: string,
	kind: "username" | "workspace owner" | "workspace name",
): string {
	if (!isValidIdentifier(value)) {
		throw new InputValidationError(
			`Cannot use this ${kind} in an SSH connection: it contains unsupported characters or separators.`,
			value,
		);
	}
	return value;
}

/** Legacy agent names may have leading/trailing hyphens and underscores. */
export function validateAgentName(value: string): string {
	if (!/^[\w-]+$/.test(value) || value.includes("--")) {
		throw new InputValidationError(
			"Cannot use this agent name in an SSH connection: it contains unsupported characters or separators.",
			value,
		);
	}
	return value;
}

/** Returns the hostname unchanged when it is safe as a filesystem component. */
export function validateFilenameHostname(value: string): string {
	if (
		!value ||
		/^\.+$/.test(value) ||
		/[/\\]/.test(value) ||
		/\p{Cc}/u.test(value)
	) {
		throw new InputValidationError(
			"Cannot use this deployment hostname for local storage: it is empty or contains unsafe path characters.",
			value,
		);
	}
	if (
		os.platform() === "win32" &&
		(/[<>:"|?*]/.test(value) ||
			/[. ]$/.test(value) ||
			/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
	) {
		throw new InputValidationError(
			"Cannot connect on Windows: this deployment hostname cannot be used as a local directory name.",
			value,
		);
	}
	return value;
}

/** Shell-safe, literal SSH host characters; IP structure uses Node's parser. */
export function isShellSafeHostname(value: string): boolean {
	return (
		/^[\w.-]+$/.test(value) ||
		(value.startsWith("[") &&
			value.endsWith("]") &&
			!value.includes("%") &&
			isIP(value.slice(1, -1)) === 6)
	);
}

export function validateShellSafeHostname(value: string): string {
	if (!isShellSafeHostname(value)) {
		throw new InputValidationError(
			"Cannot use this deployment hostname in an SSH connection: it contains shell metacharacters or wildcard patterns.",
			value,
		);
	}
	return value;
}

/**
 * Validates a deployment URL for sign-in, storage reads, and the SSH
 * `ProxyCommand`, and returns it unchanged. Rejects credentials, which the SSH
 * config would store in plain text; query parameters and fragments, which
 * break API paths built on the URL; and characters that are not literal
 * inside shell quotes, including OpenSSH's `%` tokens.
 */
export function validateDeploymentUrl(value: string): string {
	const url = parseDeploymentUrl(value);
	if (url.username || url.password || /[?#]/.test(url.href)) {
		throw new InputValidationError(
			"Invalid URL: the deployment URL cannot include a username, password, query, or fragment.",
			OMITTED_URL,
		);
	}
	if (!/^[\w\-.~:/[\]@!*+,=]+$/.test(value)) {
		throw new InputValidationError(
			"Invalid URL: the deployment URL cannot be safely used in an SSH connection because it contains unsupported or percent-encoded characters.",
			OMITTED_URL,
		);
	}
	return value;
}

export function isValidDeploymentUrl(value: string): boolean {
	try {
		validateDeploymentUrl(value);
		return true;
	} catch {
		return false;
	}
}
