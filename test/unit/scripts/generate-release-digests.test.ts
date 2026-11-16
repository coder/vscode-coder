import { createTar } from "nanotar";
import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
	buildInfo,
	embeddedCliDigests,
	isSignedByCoder,
} from "../../../scripts/generate-release-digests.mjs";

const CODER_SUBJECT =
	"CN=Coder Technologies Inc.,O=Coder Technologies Inc.,L=Austin,ST=Texas,C=US";

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** A zstd-compressed tar of these files, as a Coder server embeds them. */
function compressedTar(files: Record<string, string>): Uint8Array {
	return zstdCompressSync(
		createTar(Object.entries(files).map(([name, data]) => ({ name, data }))),
	);
}

/** A string as Go writes it in build info: its varint length, then UTF-8. */
function goString(value: string): Buffer {
	const bytes: number[] = [];
	let length = Buffer.byteLength(value);
	while (length >= 0x80) {
		bytes.push((length & 0x7f) | 0x80);
		length >>= 7;
	}
	bytes.push(length);
	return Buffer.concat([Buffer.from(bytes), Buffer.from(value)]);
}

/** The parts of `osslsigncode verify` output that identify the signer. */
function verifyOutput(subject: string, result: string): string {
	return [
		"Signer's certificate:",
		"\t------------------",
		"\tSigner #0:",
		`\t\tSubject: ${subject}`,
		"\t\tIssuer : CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1",
		"",
		`Signature verification: ${result}`,
		"",
	].join("\n");
}

describe("generate-release-digests", () => {
	it("hashes the CLI binaries embedded in a server binary", async () => {
		const server = Buffer.concat([
			Buffer.from("server code"),
			compressedTar({ "index.html": "<html></html>" }),
			Buffer.from("more server code"),
			compressedTar({
				"coder-linux-amd64": "linux binary",
				"coder-windows-amd64.exe": "windows binary",
				"coder.sha1": "checksums",
			}),
			Buffer.from("trailing server code"),
		]);
		await expect(embeddedCliDigests(server)).resolves.toEqual({
			"coder-linux-amd64": sha256("linux binary"),
			"coder-windows-amd64.exe": sha256("windows binary"),
		});
	});

	interface SignerCase {
		name: string;
		subject: string;
		result: string;
		signedByCoder: boolean;
	}
	it.each<SignerCase>([
		{
			name: "a verified signature by Coder",
			subject: CODER_SUBJECT,
			result: "ok",
			signedByCoder: true,
		},
		{
			name: "a signer that only shares Coder's name",
			subject: "CN=Coder Technologies Inc.,O=Someone Else",
			result: "ok",
			signedByCoder: false,
		},
		{
			name: "a failed verification",
			subject: CODER_SUBJECT,
			result: "failed",
			signedByCoder: false,
		},
	])(
		"checks Authenticode output with $name",
		({ subject, result, signedByCoder }) => {
			expect(isSignedByCoder(verifyOutput(subject, result))).toBe(
				signedByCoder,
			);
		},
	);

	it("reads the release version and commit from Go build info", () => {
		const moduleInfo = [
			"path\tgithub.com/coder/coder/v2/enterprise/cmd/coder",
			"mod\tgithub.com/coder/coder/v2\tv2.30.0+dirty\t",
			"build\t-ldflags=\"-X 'github.com/coder/coder/v2/buildinfo.tag=2.30.0' -s -w\"",
			"build\tvcs=git",
			"build\tvcs.revision=43e67d12e278e13399cffc77f132e8e628339477",
			"build\tvcs.time=2026-02-03T16:58:25Z",
			// Long enough for a multi-byte varint length.
			`dep\t${"x".repeat(200)}`,
			"",
		].join("\n");
		const binary = Buffer.concat([
			Buffer.from("program code"),
			Buffer.from("\xff Go buildinf:", "latin1"),
			Buffer.from([8, 2]),
			Buffer.alloc(16),
			goString("go1.25.6"),
			goString(moduleInfo),
			Buffer.from("more program code"),
		]);
		expect(buildInfo(binary)).toEqual({
			version: "2.30.0",
			commit: "43e67d12e278e13399cffc77f132e8e628339477",
		});
	});
});
