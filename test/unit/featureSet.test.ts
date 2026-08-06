import * as semver from "semver";
import { describe, expect, it } from "vitest";

import {
	type FeatureSet,
	featureSetForVersion,
	tasksSupported,
} from "@/featureSet";

function expectFlag(
	flag: keyof FeatureSet,
	below: string[],
	atOrAbove: string[],
) {
	for (const v of below) {
		expect(featureSetForVersion(semver.parse(v))[flag]).toBeFalsy();
	}
	for (const v of atOrAbove) {
		expect(featureSetForVersion(semver.parse(v))[flag]).toBeTruthy();
	}
}

describe("check version support", () => {
	it("proxy log directory", () => {
		expectFlag(
			"proxyLogDirectory",
			["v1.3.3+e491217", "v2.3.3+e491217", "v2.3.9+e491217"],
			["v2.4.0+e491217", "v5.3.4+e491217", "v5.0.4+e491217"],
		);
	});
	it("wildcard ssh", () => {
		expectFlag(
			"wildcardSSH",
			["v1.3.3+e491217", "v2.3.3+e491217"],
			["v2.19.0", "v2.19.1", "v2.20.0+e491217", "v5.0.4+e491217"],
		);
	});
	it("cli login", () => {
		expectFlag(
			"cliLogin",
			["v0.24.0", "v0.14.0", "v0.0.1"],
			["v0.25.0", "v0.25.1", "v2.31.0", "v3.0.0"],
		);
	});
	it("keyring auth", () => {
		expectFlag(
			"keyringAuth",
			["v2.28.0", "v2.28.9", "v1.0.0", "v2.3.3+e491217"],
			["v2.29.0", "v2.29.1", "v2.30.0", "v3.0.0"],
		);
	});
	it("token read", () => {
		expectFlag(
			"tokenRead",
			["v2.30.0", "v2.29.0", "v2.28.0", "v1.0.0"],
			["v2.31.0", "v2.31.1", "v2.32.0", "v3.0.0"],
		);
	});
	it("support bundle", () => {
		expectFlag(
			"supportBundle",
			["v2.9.0", "v2.9.9", "v1.0.0", "v2.3.3+e491217"],
			["v2.10.0", "v2.10.1", "v2.11.0", "v3.0.0"],
		);
	});
	it("support bundle workspace files", () => {
		expectFlag(
			"supportBundleWorkspaceFiles",
			["v2.35.0", "v2.35.2", "v2.35.99"],
			["v2.36.0", "v2.36.1", "v2.37.0", "v3.0.0"],
		);
	});
	it("tasks panel only on deployments before deprecation", () => {
		for (const v of ["v2.34.0", "v2.34.7+e491217", "v2.0.0"]) {
			expect(tasksSupported(semver.parse(v)), v).toBe(true);
		}
		for (const v of ["v2.35.0", "v2.36.1", "v3.0.0", "v2.36.0-devel+abc123"]) {
			expect(tasksSupported(semver.parse(v)), v).toBe(false);
		}
		expect(tasksSupported(null)).toBe(false);
	});

	it("enables all features for development builds", () => {
		const featureSet = featureSetForVersion(
			semver.parse("v0.0.0-devel+abc123"),
		);

		for (const [feature, enabled] of Object.entries(featureSet)) {
			expect(enabled, feature).toBe(true);
		}
	});
});
