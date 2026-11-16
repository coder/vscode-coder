import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import * as semver from "semver";
import { describe, expect, it } from "vitest";

import * as releaseDigests from "@/releaseDigests";

import { getFixturePath } from "../utils/fixtures";

describe("releaseDigests", () => {
	// Just a text file, not an actual binary.
	const cliPath = getFixturePath("pgp", "cli");
	const version = new semver.SemVer("v2.33.0");

	async function digestsFor(
		versionKey: string,
		binName: string,
	): Promise<releaseDigests.ReleaseDigests> {
		const digest = createHash("sha256")
			.update(await fs.readFile(cliPath))
			.digest("hex");
		return { [versionKey]: { [binName]: digest } };
	}

	it("reads bundled release digests", async () => {
		const digests = await releaseDigests.readReleaseDigests();
		for (const binaries of Object.values(digests)) {
			for (const digest of Object.values(binaries)) {
				expect(digest).toMatch(/^[0-9a-f]{64}$/);
			}
		}
	});

	it("matches the released binary", async () => {
		const digests = await digestsFor("2.33.0", "coder-linux-amd64");
		await expect(
			releaseDigests.isReleasedBinary(
				digests,
				cliPath,
				version,
				"coder-linux-amd64",
			),
		).resolves.toBe(true);
	});

	it("ignores pre-release and build metadata in the version", async () => {
		const digests = await digestsFor("2.33.0", "coder-linux-amd64");
		await expect(
			releaseDigests.isReleasedBinary(
				digests,
				cliPath,
				new semver.SemVer("v2.33.0+abc123"),
				"coder-linux-amd64",
			),
		).resolves.toBe(true);
	});

	it("rejects a binary with a different digest", async () => {
		const digests = {
			"2.33.0": { "coder-linux-amd64": "0".repeat(64) },
		};
		await expect(
			releaseDigests.isReleasedBinary(
				digests,
				cliPath,
				version,
				"coder-linux-amd64",
			),
		).resolves.toBe(false);
	});

	it("rejects a released binary of another version", async () => {
		const digests = await digestsFor("2.32.0", "coder-linux-amd64");
		await expect(
			releaseDigests.isReleasedBinary(
				digests,
				cliPath,
				version,
				"coder-linux-amd64",
			),
		).resolves.toBe(false);
	});

	it("rejects a released binary of another platform", async () => {
		const digests = await digestsFor("2.33.0", "coder-darwin-arm64");
		await expect(
			releaseDigests.isReleasedBinary(
				digests,
				cliPath,
				version,
				"coder-linux-amd64",
			),
		).resolves.toBe(false);
	});
});
