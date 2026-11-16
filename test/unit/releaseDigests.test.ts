import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as semver from "semver";
import { describe, expect, it } from "vitest";

import {
	type Digests,
	ReleaseDigests,
	readReleaseDigests,
} from "@/releaseDigests";

import { createMockLogger } from "../mocks/testHelpers";
import { getFixturePath } from "../utils/fixtures";

describe("ReleaseDigests", () => {
	// Just a text file, not an actual binary.
	const cliPath = getFixturePath("pgp", "cli");
	const cliDigest = createHash("sha256")
		.update(readFileSync(cliPath))
		.digest("hex");
	const version = new semver.SemVer("2.33.0");

	function withDigests(digests: Digests): ReleaseDigests {
		return new ReleaseDigests(digests, createMockLogger());
	}

	it("lists past releases in the bundled digests", async () => {
		const digests = withDigests(
			readReleaseDigests(path.resolve(__dirname, "../../release-digests.json")),
		);
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("mismatch");
	});

	it("matches the released binary", async () => {
		const digests = withDigests({
			"2.33.0": { "coder-linux-amd64": cliDigest },
		});
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("match");
	});

	it("ignores build metadata in the version", async () => {
		const digests = withDigests({
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
		const digests = withDigests({
			"2.33.0": { "coder-linux-amd64": "0".repeat(64) },
		});
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("mismatch");
	});

	it.each([
		["another version", "2.32.0", "coder-linux-amd64"],
		["another platform", "2.33.0", "coder-darwin-arm64"],
	])("does not match a binary released for %s", async (_, release, binName) => {
		const digests = withDigests({
			[release]: { [binName]: cliDigest },
		});
		await expect(
			digests.check(cliPath, version, "coder-linux-amd64"),
		).resolves.toBe("unlisted");
	});
});
