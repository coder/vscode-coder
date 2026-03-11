import type * as semver from "semver";

export interface FeatureSet {
	vscodessh: boolean;
	proxyLogDirectory: boolean;
	wildcardSSH: boolean;
	buildReason: boolean;
	keyringAuth: boolean;
	keyringTokenRead: boolean;
}

/**
 * True when the CLI version is at least `minVersion`, or is a dev build.
 * Returns false for null (unknown) versions.
 */
function versionAtLeast(
	version: semver.SemVer | null,
	minVersion: string,
): boolean {
	if (!version) {
		return false;
	}
	return version.compare(minVersion) >= 0 || version.prerelease[0] === "devel";
}

/**
 * Builds and returns a FeatureSet object for a given coder version.
 */
export function featureSetForVersion(
	version: semver.SemVer | null,
): FeatureSet {
	return {
		vscodessh: !(
			version?.major === 0 &&
			version?.minor <= 14 &&
			version?.patch < 1 &&
			version?.prerelease.length === 0
		),

		// --log-dir flag for proxy logs; vscodessh fails if unsupported
		proxyLogDirectory: versionAtLeast(version, "2.4.0"),
		// Wildcard SSH host matching
		wildcardSSH: versionAtLeast(version, "2.19.0"),
		// --reason flag for `coder start`
		buildReason: versionAtLeast(version, "2.25.0"),
		// Keyring-backed token storage via `coder login`
		keyringAuth: versionAtLeast(version, "2.29.0"),
		// `coder login token` for reading tokens from the keyring
		keyringTokenRead: versionAtLeast(version, "2.31.0"),
	};
}
