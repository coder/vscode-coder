import { type Logger } from "./logging/logger";

/** A single entry in the CLI's keyring credential map. */
interface CredentialEntry {
	coder_url: string;
	api_token: string;
}

type CredentialMap = Record<string, CredentialEntry>;

/** Subset of @napi-rs/keyring Entry used for credential storage. */
export interface KeyringEntry {
	getPassword(): string | null;
	setPassword(password: string): void;
	getSecret(): Uint8Array | null;
	setSecret(secret: Uint8Array): void;
	deleteCredential(): void;
}

const KEYRING_SERVICE = "coder-v2-credentials";
const KEYRING_ACCOUNT = "coder-login-credentials";

function createDefaultEntry(): KeyringEntry {
	// Lazy require so Linux never loads the native binary.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { Entry } = require("@napi-rs/keyring") as {
		Entry: {
			new (service: string, username: string): KeyringEntry;
			withTarget(
				target: string,
				service: string,
				username: string,
			): KeyringEntry;
		};
	};

	if (process.platform === "darwin") {
		// On macOS, withTarget selects a keychain domain, not an attribute — using
		// it creates a separate entry the CLI can't find.  The two-arg constructor
		// matches the CLI's kSecAttrService + kSecAttrAccount lookup.
		return new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
	}

	// On Windows, withTarget sets the credential's lookup key, matching the CLI.
	return Entry.withTarget(KEYRING_SERVICE, KEYRING_SERVICE, KEYRING_ACCOUNT);
}

/** Extracts the host from a URL for use as credential map key (matches CLI format). */
function toHost(deploymentUrl: string): string {
	try {
		return new URL(deploymentUrl).host;
	} catch {
		return deploymentUrl;
	}
}

/**
 * Finds the map key matching a safeHostname (ports stripped). Map keys use
 * `new URL().host` which preserves ports, so the fallback strips ports to match.
 */
function findMapKey(
	map: CredentialMap,
	safeHostname: string,
): string | undefined {
	if (safeHostname in map) {
		return safeHostname;
	}
	for (const key of Object.keys(map)) {
		const hostWithoutPort = key.replace(/:\d+$/, "");
		if (hostWithoutPort === safeHostname) {
			return key;
		}
	}
	return undefined;
}

/**
 * Returns true on platforms where the OS keyring is supported (macOS, Windows).
 */
export function isKeyringSupported(): boolean {
	return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Wraps @napi-rs/keyring with the credential encoding the Coder CLI expects.
 * The native module is loaded lazily so Linux never touches it.
 *
 * Encoding (must match CLI):
 *   macOS: base64-encoded JSON via setPassword/getPassword
 *   Windows: raw UTF-8 JSON bytes via setSecret/getSecret
 */
export class KeyringStore {
	constructor(
		private readonly logger: Logger,
		private readonly entryFactory: () => KeyringEntry = createDefaultEntry,
	) {}

	setToken(deploymentUrl: string, token: string): void {
		this.assertSupported();
		const entry = this.entryFactory();
		const map = this.readMap(entry);
		const host = toHost(deploymentUrl);
		map[host] = { coder_url: host, api_token: token };
		this.writeMap(entry, map);
	}

	getToken(safeHostname: string): string | undefined {
		this.assertSupported();
		const entry = this.entryFactory();
		const map = this.readMap(entry);
		const key = findMapKey(map, safeHostname);
		return key !== undefined ? map[key].api_token : undefined;
	}

	deleteToken(safeHostname: string): void {
		this.assertSupported();
		const entry = this.entryFactory();
		const map = this.readMap(entry);
		const key = findMapKey(map, safeHostname);
		if (key === undefined) {
			return;
		}
		delete map[key];
		if (Object.keys(map).length === 0) {
			try {
				entry.deleteCredential();
			} catch {
				// NoEntry is fine — nothing to delete
			}
		} else {
			this.writeMap(entry, map);
		}
	}

	private assertSupported(): void {
		if (!isKeyringSupported()) {
			throw new Error(`Keyring is not supported on ${process.platform}`);
		}
	}

	private readMap(entry: KeyringEntry): CredentialMap {
		try {
			const raw = this.readRaw(entry);
			if (!raw) {
				return {};
			}
			return JSON.parse(raw) as CredentialMap;
		} catch (error) {
			this.logger.warn("Failed to read keyring credential map", error);
			return {};
		}
	}

	private readRaw(entry: KeyringEntry): string | null {
		if (process.platform === "darwin") {
			const password = entry.getPassword();
			return password !== null
				? Buffer.from(password, "base64").toString("utf-8")
				: null;
		}
		if (process.platform === "win32") {
			const secret = entry.getSecret();
			return secret !== null ? Buffer.from(secret).toString("utf-8") : null;
		}
		throw new Error(`Keyring is not supported on ${process.platform}`);
	}

	private writeMap(entry: KeyringEntry, map: CredentialMap): void {
		const json = JSON.stringify(map);
		if (process.platform === "darwin") {
			entry.setPassword(Buffer.from(json).toString("base64"));
			return;
		}
		if (process.platform === "win32") {
			entry.setSecret(Buffer.from(json));
			return;
		}
		throw new Error(`Keyring is not supported on ${process.platform}`);
	}
}
