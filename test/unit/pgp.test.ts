import fs from "fs/promises";
import * as openpgp from "openpgp";
import path from "path";
import { describe, expect, it } from "vitest";

import * as pgp from "@/pgp";

import { getFixturePath } from "../utils/fixtures";

describe("pgp", () => {
	// This contains two keys, like Coder's.
	const publicKeysPath = getFixturePath("pgp", "public.pgp");
	// Just a text file, not an actual binary.
	const cliPath = getFixturePath("pgp", "cli");
	const invalidSignaturePath = getFixturePath("pgp", "cli.invalid.asc");
	// This is signed with the second key, like Coder's.
	const validSignaturePath = getFixturePath("pgp", "cli.valid.asc");

	it("reads bundled public keys", async () => {
		const keys = await pgp.readPublicKeys();
		expect(keys.length).toBe(1);
		expect(keys[0].getKeyID().toHex()).toBe("6a5a671b5e40a3b9");
	});

	it("cannot read non-existent signature", async () => {
		const armoredKeys = await fs.readFile(publicKeysPath, "utf8");
		const publicKeys = await openpgp.readKeys({ armoredKeys });
		await expect(
			pgp.verifySignature(
				publicKeys,
				cliPath,
				path.join(__dirname, "does-not-exist"),
			),
		).rejects.toThrow("Failed to read");
	});

	it("cannot read invalid signature", async () => {
		const armoredKeys = await fs.readFile(publicKeysPath, "utf8");
		const publicKeys = await openpgp.readKeys({ armoredKeys });
		await expect(
			pgp.verifySignature(publicKeys, cliPath, invalidSignaturePath),
		).rejects.toThrow("Failed to read");
	});

	it("cannot read file", async () => {
		const armoredKeys = await fs.readFile(publicKeysPath, "utf8");
		const publicKeys = await openpgp.readKeys({ armoredKeys });
		await expect(
			pgp.verifySignature(
				publicKeys,
				path.join(__dirname, "does-not-exist"),
				validSignaturePath,
			),
		).rejects.toThrow("Failed to read");
	});

	it("mismatched signature", async () => {
		const armoredKeys = await fs.readFile(publicKeysPath, "utf8");
		const publicKeys = await openpgp.readKeys({ armoredKeys });
		await expect(
			pgp.verifySignature(publicKeys, __filename, validSignaturePath),
		).rejects.toThrow("Unable to verify");
	});

	it("verifies signature", async () => {
		const armoredKeys = await fs.readFile(publicKeysPath, "utf8");
		const publicKeys = await openpgp.readKeys({ armoredKeys });
		await pgp.verifySignature(publicKeys, cliPath, validSignaturePath);
	});
});
