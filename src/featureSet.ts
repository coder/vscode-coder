import * as semver from "semver";

/** Supported baseline for the Coder server and, independently, the CLI. */
export const MIN_SUPPORTED_CODER_VERSION = "2.29.0";

/** Optional capabilities above the supported Coder CLI baseline of 2.29.0. */
export interface CliFeatureSet {
	tokenRead: boolean;
	sshTty: boolean;
	supportBundleWorkspaceFiles: boolean;
	allowRedirectsFlag: boolean;
	keyringByOrigin: boolean;
	customSessionAppNames: boolean;
}

/** Optional capabilities keyed independently to the Coder server version. */
export interface ServerFeatureSet {
	tasks: boolean;
	onSuccessBuild: boolean;
	customSessionAppNames: boolean;
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

/** Parse the server version and reject unsupported releases; development builds are allowed. */
export function requireSupportedServerVersion(version: string): semver.SemVer {
	const parsed = semver.parse(version);
	if (!parsed) {
		throw new Error(`Got invalid version from deployment: ${version}`);
	}
	if (!versionAtLeast(parsed, MIN_SUPPORTED_CODER_VERSION)) {
		throw new Error(
			`Your Coder server is version ${version}. This extension requires Coder server ${MIN_SUPPORTED_CODER_VERSION} or newer. Upgrade your deployment to continue.`,
		);
	}
	return parsed;
}

/**
 * CLI capabilities; unknown versions use the supported baseline.
 * @throws {Error} for known unsupported releases.
 */
export function cliFeatureSet(version: semver.SemVer | null): CliFeatureSet {
	if (version && !versionAtLeast(version, MIN_SUPPORTED_CODER_VERSION)) {
		throw new Error(
			`Your Coder CLI is version ${version.version}. This extension requires Coder CLI ${MIN_SUPPORTED_CODER_VERSION} or newer. Upgrade your CLI to continue.`,
		);
	}
	return {
		// Keyring entries keyed by origin rather than host (coder/coder#29764)
		keyringByOrigin: versionAtLeast(version, "2.39.0"),
		// `coder login token`; from 2.32 file mode also checks the URL it stored.
		tokenRead: versionAtLeast(version, "2.32.0"),
		// `coder ssh --tty`; earlier CLIs always allocate a PTY in command mode
		sshTty: versionAtLeast(version, "2.34.0"),
		// --workspace-file flag for `coder support bundle`
		supportBundleWorkspaceFiles: versionAtLeast(version, "2.36.0"),
		// --allow-redirects
		allowRedirectsFlag: versionAtLeast(version, "2.38.0"),
		customSessionAppNames: versionAtLeast(version, "2.38.0"),
	};
}

/** Capabilities of the given deployment version. */
export function serverFeatureSet(
	version: semver.SemVer | null,
): ServerFeatureSet {
	return {
		// `/api/v2/tasks` is deprecated from 2.35.
		tasks: version !== null && !versionAtLeast(version, "2.35.0"),
		// `on_success` on a stop build, which queues the start in one request
		onSuccessBuild: versionAtLeast(version, "2.36.0"),
		customSessionAppNames: versionAtLeast(version, "2.38.0"),
	};
}
