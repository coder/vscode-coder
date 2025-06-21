import * as semver from "semver";
import { describe, expect, it } from "vitest";
import { featureSetForVersion } from "./featureSet";

describe("check version support", () => {
	it("has logs", () => {
		["v1.3.3+e491217", "v2.3.3+e491217"].forEach((v: string) => {
			expect(
				featureSetForVersion(semver.parse(v)).proxyLogDirectory,
			).toBeFalsy();
		});
		["v2.3.4+e491217", "v5.3.4+e491217", "v5.0.4+e491217"].forEach(
			(v: string) => {
				expect(
					featureSetForVersion(semver.parse(v)).proxyLogDirectory,
				).toBeTruthy();
			},
		);
	});
	it("wildcard ssh", () => {
		["v1.3.3+e491217", "v2.3.3+e491217"].forEach((v: string) => {
			expect(featureSetForVersion(semver.parse(v)).wildcardSSH).toBeFalsy();
		});
		["v2.19.0", "v2.19.1", "v2.20.0+e491217", "v5.0.4+e491217"].forEach(
			(v: string) => {
				expect(featureSetForVersion(semver.parse(v)).wildcardSSH).toBeTruthy();
			},
		);
	});

	it("vscodessh support", () => {
		// Test versions that don't support vscodessh (0.14.0 and below without prerelease)
		expect(featureSetForVersion(semver.parse("v0.14.0"))).toMatchObject({
			vscodessh: false,
		});
		expect(featureSetForVersion(semver.parse("v0.13.0"))).toMatchObject({
			vscodessh: false,
		});
		expect(featureSetForVersion(semver.parse("v0.14.1-beta"))).toMatchObject({
			vscodessh: true,
		});

		// Test versions that support vscodessh
		expect(featureSetForVersion(semver.parse("v0.14.1"))).toMatchObject({
			vscodessh: true,
		});
		expect(featureSetForVersion(semver.parse("v0.15.0"))).toMatchObject({
			vscodessh: true,
		});
		expect(featureSetForVersion(semver.parse("v1.0.0"))).toMatchObject({
			vscodessh: true,
		});
	});

	it("handles null version", () => {
		const features = featureSetForVersion(null);
		expect(features.vscodessh).toBe(true);
		expect(features.proxyLogDirectory).toBe(false);
		expect(features.wildcardSSH).toBe(false);
	});

	it("handles devel prerelease", () => {
		const devVersion = semver.parse("v2.0.0-devel");
		const features = featureSetForVersion(devVersion);
		expect(features.proxyLogDirectory).toBe(true);
		expect(features.wildcardSSH).toBe(true);
	});
});
