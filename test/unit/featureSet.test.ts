import * as semver from "semver";
import { describe, expect, it } from "vitest";

import { type FeatureSet, featureSetForVersion } from "@/featureSet";

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
	expect(
		featureSetForVersion(semver.parse("0.0.0-devel+abc123"))[flag],
	).toBeTruthy();
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
	it("keyring auth", () => {
		expectFlag(
			"keyringAuth",
			["v2.28.0", "v2.28.9", "v1.0.0", "v2.3.3+e491217"],
			["v2.29.0", "v2.29.1", "v2.30.0", "v3.0.0"],
		);
	});
	it("keyring token read", () => {
		expectFlag(
			"keyringTokenRead",
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
});
