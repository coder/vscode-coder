import * as semver from "semver";
import { describe, expect, it } from "vitest";

import {
	type CliFeatureSet,
	cliFeatureSet,
	serverFeatureSet,
} from "@/featureSet";

function expectFlag(
	flag: keyof CliFeatureSet,
	below: string[],
	atOrAbove: string[],
) {
	for (const v of below) {
		expect(cliFeatureSet(semver.parse(v))[flag]).toBeFalsy();
	}
	for (const v of atOrAbove) {
		expect(cliFeatureSet(semver.parse(v))[flag]).toBeTruthy();
	}
}

describe("check version support", () => {
	it.each(["2.28.9", "2.29.0-rc.1"])(
		"rejects known unsupported CLI version %s with an upgrade message",
		(version) => {
			expect(() => cliFeatureSet(semver.parse(version))).toThrow(
				`Your Coder CLI is version ${version}. This extension requires Coder CLI 2.29.0 or newer. Upgrade your CLI to continue.`,
			);
		},
	);

	it("token read", () => {
		expectFlag(
			"tokenRead",
			["v2.31.1", "v2.31.0", "v2.30.0", "v2.29.0"],
			["v2.32.0", "v2.32.1", "v2.33.0", "v3.0.0"],
		);
	});
	it("ssh tty", () => {
		expectFlag(
			"sshTty",
			["v2.29.0", "v2.33.11"],
			["v2.34.0", "v2.34.1", "v2.35.0", "v3.0.0"],
		);
	});
	it("keyring by origin", () => {
		expectFlag(
			"keyringByOrigin",
			["v2.38.4", "v2.38.0", "v2.29.0"],
			["v2.39.0", "v2.39.1", "v3.0.0"],
		);
	});
	it("allow redirects", () => {
		expectFlag(
			"allowRedirectsFlag",
			["v2.37.1", "v2.37.0", "v2.36.5", "v2.29.0"],
			["v2.38.0", "v2.38.1", "v2.39.0", "v3.0.0"],
		);
	});
	it("support bundle workspace files", () => {
		expectFlag(
			"supportBundleWorkspaceFiles",
			["v2.35.0", "v2.35.2", "v2.35.99"],
			["v2.36.0", "v2.36.1", "v2.37.0", "v3.0.0"],
		);
	});
	it("tasks panel from the stable API until the deprecation", () => {
		for (const v of ["v2.29.0", "v2.34.0", "v2.34.7+e491217"]) {
			expect(serverFeatureSet(semver.parse(v)).tasks, v).toBe(true);
		}
		for (const v of ["v2.35.0", "v2.30.0-devel+abc123"]) {
			expect(serverFeatureSet(semver.parse(v)).tasks, v).toBe(false);
		}
		expect(serverFeatureSet(null).tasks).toBe(false);
	});

	it("one-build restart from 2.36", () => {
		for (const v of ["v2.35.9", "v2.0.0"]) {
			expect(serverFeatureSet(semver.parse(v)).onSuccessBuild, v).toBe(false);
		}
		for (const v of ["v2.36.0", "v2.37.1", "v0.0.0-devel+abc123"]) {
			expect(serverFeatureSet(semver.parse(v)).onSuccessBuild, v).toBe(true);
		}
	});

	it.each([
		["2.37.99", false],
		["2.38.0-rc.1", false],
		["2.38.0", true],
		["0.0.0-devel+abc123", true],
		["invalid", false],
	] as const)("custom session app names for %s: %s", (version, expected) => {
		const parsed = semver.parse(version);
		expect(cliFeatureSet(parsed).customSessionAppNames).toBe(expected);
		expect(serverFeatureSet(parsed).customSessionAppNames).toBe(expected);
	});

	it("enables all features for development builds", () => {
		const featureSet = cliFeatureSet(semver.parse("v0.0.0-devel+abc123"));

		for (const [feature, enabled] of Object.entries(featureSet)) {
			expect(enabled, feature).toBe(true);
		}
	});
});
