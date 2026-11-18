import fs from "node:fs/promises";

import type * as semver from "semver";

import type { Logger } from "../logging/logger";

/**
 * Signatures for the releases Coder published before its current release key.
 * Their deployments cannot serve them, so they ship with the extension in one
 * file, keyed by version (major.minor.patch) and then by binary name.
 */
export class ReleaseSignatures {
	private signatures?: Record<string, Record<string, string>>;

	constructor(
		private readonly signaturesPath: string,
		private readonly logger: Logger,
	) {}

	/** The signature for the released binName of this version, if any. */
	public async find(
		version: semver.SemVer,
		binName: string,
	): Promise<string | undefined> {
		if (version.prerelease.length > 0) {
			return undefined;
		}
		const release = `${version.major}.${version.minor}.${version.patch}`;
		this.signatures ??= JSON.parse(
			await fs.readFile(this.signaturesPath, "utf8"),
		) as Record<string, Record<string, string>>;
		const signature = this.signatures[release]?.[binName];
		if (signature) {
			this.logger.info("Using the bundled signature for", binName, release);
		}
		return signature;
	}
}
