import type * as semver from "semver";

/** Capabilities keyed to the Coder CLI version. */
export interface CliFeatureSet {
	cliLogin: boolean;
	proxyLogDirectory: boolean;
	wildcardSSH: boolean;
	buildReason: boolean;
	cliUpdate: boolean;
	keyringAuth: boolean;
	tokenRead: boolean;
	supportBundle: boolean;
	supportBundleWorkspaceFiles: boolean;
	allowRedirects: boolean;
}

/** Capabilities keyed to the Coder server (REST API) version. */
export interface ServerFeatureSet {
	tasks: boolean;
	onSuccessBuild: boolean;
}

/**
 * True when the version is at least `minVersion`, or is a dev build.
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

/** Capabilities of the given CLI version. */
export function cliFeatureSet(version: semver.SemVer | null): CliFeatureSet {
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
		// `coder login token`; from 2.32 file mode also checks the URL it stored.
		tokenRead: versionAtLeast(version, "2.32.0"),
		// `coder support bundle` (officially released/unhidden in 2.10.0)
		supportBundle: versionAtLeast(version, "2.10.0"),
		// --workspace-file flag for `coder support bundle`
		supportBundleWorkspaceFiles: versionAtLeast(version, "2.36.0"),
		// --allow-redirects; from 2.38 the CLI otherwise errors on a redirected URL.
		allowRedirects: versionAtLeast(version, "2.38.0"),
	};
}

/** Capabilities of the given deployment version. */
export function serverFeatureSet(
	version: semver.SemVer | null,
): ServerFeatureSet {
	return {
		// `/api/v2/tasks`, stable from 2.29 until the 2.35 deprecation
		tasks:
			versionAtLeast(version, "2.29.0") && !versionAtLeast(version, "2.35.0"),
		// `on_success` on a stop build, which queues the start in one request
		onSuccessBuild: versionAtLeast(version, "2.36.0"),
	};
}
