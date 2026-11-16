import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as semver from "semver";
import { describe, expect, it } from "vitest";

import {
	type Digests,
	ReleaseDigests,
	readReleaseDigests,
} from "@/cli/releaseDigests";

import { createMockLogger } from "../../mocks/testHelpers";
import { getFixturePath } from "../../utils/fixtures";

describe("ReleaseDigests", () => {
	// Just a text file, not an actual binary.
	const cliPath = getFixturePath("pgp", "cli");
	const cliDigest = createHash("sha256")
		.update(readFileSync(cliPath))
		.digest("hex");
	const version = new semver.SemVer("2.33.0");

	function createDigests(digests: Digests): ReleaseDigests {
		return new ReleaseDigests(digests, createMockLogger());
	}

	it("lists past releases in the bundled digests", async () => {
		const digests = createDigests(
			readReleaseDigests(
				path.resolve(__dirname, "../../../release-digests.json"),
			),
		);
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("mismatch");
	});

	it("matches the released binary", async () => {
		const digests = createDigests({
			"2.33.0": { "coder-linux-amd64": cliDigest },
		});
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("match");
	});

	it("ignores build metadata in the version", async () => {
		const digests = createDigests({
			"2.33.0": { "coder-linux-amd64": cliDigest },
		});
		await expect(
			digests.check(
				cliPath,
				new semver.SemVer("v2.33.0+abc123"),
				"coder-linux-amd64",
			),
		).resolves.toBe("match");
	});

	it("reports a binary that differs from its release", async () => {
		const digests = createDigests({
			"2.33.0": { "coder-linux-amd64": "0".repeat(64) },
		});
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("mismatch");
	});

	interface OtherReleaseCase {
		name: string;
		release: string;
		binName: string;
	}
	it.each<OtherReleaseCase>([
		{
			name: "another version",
			release: "2.32.0",
			binName: "coder-linux-amd64",
		},
		{
			name: "another platform",
			release: "2.33.0",
			binName: "coder-darwin-arm64",
		},
	])(
		"does not match a binary released for $name",
		async ({ release, binName }) => {
			const digests = createDigests({
				[release]: { [binName]: cliDigest },
			});
			await expect(
				digests.check(cliPath, version, "coder-linux-amd64"),
			).resolves.toBe("unlisted");
		},
	);
});
