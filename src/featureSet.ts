import type * as semver from "semver";

export interface FeatureSet {
	cliLogin: boolean;
	proxyLogDirectory: boolean;
	wildcardSSH: boolean;
	buildReason: boolean;
	cliUpdate: boolean;
	keyringAuth: boolean;
	tokenRead: boolean;
	supportBundle: boolean;
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
		// `coder login --use-token-as-session` to write a token (file or keyring).
		// The extension relies on this, so 0.25.0 is the minimum supported version.
		cliLogin: versionAtLeast(version, "0.25.0"),
		// --log-dir flag for proxy logs; vscodessh fails if unsupported
		proxyLogDirectory: versionAtLeast(version, "2.4.0"),
		// Wildcard SSH host matching
		wildcardSSH: versionAtLeast(version, "2.19.0"),
		// --reason flag for `coder start`
		buildReason: versionAtLeast(version, "2.25.0"),
		// `coder update` with stop transition (stops before updating)
		cliUpdate: versionAtLeast(version, "2.24.0"),
		// Keyring-backed token storage via `coder login`
		keyringAuth: versionAtLeast(version, "2.29.0"),
		// `coder login token` for reading tokens (keyring or file)
		tokenRead: versionAtLeast(version, "2.31.0"),
		// `coder support bundle` (officially released/unhidden in 2.10.0)
		supportBundle: versionAtLeast(version, "2.10.0"),
	};
}
