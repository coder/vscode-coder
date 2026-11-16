import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type * as semver from "semver";

import type { Logger } from "./logging/logger";

/**
 * SHA-256 digests of the Coder CLI binaries in releases that are not signed
 * with the current release key, keyed by version (major.minor.patch) and then
 * by binary name (for example coder-linux-amd64). Generated from the GitHub
 * attestations of each release by scripts/generate-release-digests.sh.
 */
export type ReleaseDigests = Record<string, Record<string, string>>;

/**
 * Return the release digests bundled with the plugin.
 */
export async function readReleaseDigests(
	logger?: Logger,
): Promise<ReleaseDigests> {
	const digestsFile = path.join(__dirname, "../release-digests.json");
	logger?.info("Reading release digests", digestsFile);
	return JSON.parse(await fs.readFile(digestsFile, "utf8")) as ReleaseDigests;
}

/**
 * Whether the file at cliPath is the released binName for this version, by
 * comparing its SHA-256 digest with the bundled digests. A binary from a
 * different version or platform does not match.
 */
export async function isReleasedBinary(
	digests: ReleaseDigests,
	cliPath: string,
	version: semver.SemVer,
	binName: string,
	logger?: Logger,
): Promise<boolean> {
	const key = `${version.major}.${version.minor}.${version.patch}`;
	const expected = digests[key]?.[binName];
	if (!expected) {
		logger?.info("No release digest for", binName, key);
		return false;
	}
	const hash = createHash("sha256");
	await pipeline(createReadStream(cliPath), hash);
	const actual = hash.digest("hex");
	if (actual !== expected) {
		logger?.warn(
			`Digest of ${cliPath} is ${actual}, but ${binName} ${key} was released as ${expected}`,
		);
		return false;
	}
	logger?.info("Binary matches the release digest for", binName, key);
	return true;
}
