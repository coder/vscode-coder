import fs from "node:fs/promises";
import path from "node:path";
import * as openpgp from "openpgp";
import * as semver from "semver";
import { describe, expect, it } from "vitest";

import { ReleaseSignatures } from "@/cli/releaseSignatures";
import * as pgp from "@/pgp";

import { createMockLogger } from "../../mocks/testHelpers";

const SIGNATURES_PATH = path.join(
	__dirname,
	"../../../release-signatures.json",
);
const BINARY_NAMES = [
	"coder-darwin-amd64",
	"coder-darwin-arm64",
	"coder-linux-amd64",
	"coder-linux-arm64",
	"coder-linux-armv7",
	"coder-windows-amd64.exe",
	"coder-windows-arm64.exe",
];

describe("ReleaseSignatures", () => {
	const readSignatures = async () =>
		JSON.parse(await fs.readFile(SIGNATURES_PATH, "utf8")) as Record<
			string,
			Record<string, string>
		>;

	const find = (version: string, binName: string) =>
		new ReleaseSignatures(SIGNATURES_PATH, createMockLogger()).find(
			new semver.SemVer(version),
			binName,
		);

	it.each(["2.29.0", "2.29.0-devel+abc123"])(
		"finds the signature of the release for %s",
		async (version) => {
			const signatures = await readSignatures();
			expect(await find(version, "coder-linux-amd64")).toBe(
				signatures["2.29.0"]["coder-linux-amd64"],
			);
		},
	);

	it.each([
		["0.0.1", "coder-linux-amd64"],
		["2.29.0", "coder-plan9-amd64"],
	])("finds no signature for %s %s", async (version, binName) => {
		expect(await find(version, binName)).toBeUndefined();
	});

	it("holds a signature from the bundled key for every platform of each release", async () => {
		const [key] = await pgp.readPublicKeys();
		const releases = Object.entries(await readSignatures());
		expect(releases.length).toBeGreaterThan(0);
		for (const [release, binaries] of releases) {
			expect(release).toMatch(/^\d+\.\d+\.\d+$/);
			expect(Object.keys(binaries).sort()).toEqual(BINARY_NAMES);
			for (const [binName, armoredSignature] of Object.entries(binaries)) {
				const signature = await openpgp.readSignature({ armoredSignature });
				expect(
					signature.getSigningKeyIDs().map((id) => id.toHex()),
					`${release}/${binName}`,
				).toEqual([key.getKeyID().toHex()]);
			}
		}
	});
});
