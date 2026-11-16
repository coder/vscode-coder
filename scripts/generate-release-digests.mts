/**
 * Writes release-digests.json: the SHA-256 digest of every Coder CLI binary
 * that deployments serve from /bin, for each stable coder/coder release since
 * MIN_VERSION.
 *
 * The extension trusts these digests in place of a signature, so they come
 * only from a verified server binary, never from a deployment,
 * releases.coder.com or an .asc signature. The releases in
 * AUTHENTICODE_RELEASES have no attestation, so their windows_amd64 coder.exe
 * must have Coder's Authenticode signature and Go build info naming the
 * release version and the commit of its tag. Every other release's
 * linux_amd64 archive must have build provenance from release.yaml, run on the
 * release's tag or branch for a commit on the release branch, or GitHub's
 * attestation as a release asset. The server binary embeds the CLI binaries
 * for every platform, which are extracted and hashed.
 *
 * Requires Node.js 22.18 or later, gh (authenticated) and osslsigncode 2.16,
 * whose output it parses.
 *
 * Usage: node scripts/generate-release-digests.mts [MIN_VERSION] > release-digests.json
 */
import { unzipSync } from "fflate";
import { type ParsedTarFileItem, parseTar, parseTarGzip } from "nanotar";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createZstdDecompress } from "node:zlib";
import * as semver from "semver";

const REPO = "coder/coder";
const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const CLI_BINARY = /^coder-(linux|darwin|windows)-[a-z0-9]+(\.exe)?$/;
// Lines of `osslsigncode verify` output.
const CODER_SIGNER = "CN=Coder Technologies Inc.,O=Coder Technologies Inc.,";
const SIGNER_SUBJECT =
	/Signer's certificate:\s*-+\s*Signer #0:\s*Subject: (.*)/;
const SIGNATURE_OK = /^Signature verification: ok\r?$/m;
// Lines of the module info in Go build info.
const RELEASE_VERSION = /\/buildinfo\.tag=([^\s'"]+)/;
const COMMIT = /^build\tvcs\.revision=([0-9a-f]{40})$/m;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const GO_BUILDINFO_MAGIC = Buffer.from("\xff Go buildinf:", "latin1");
// Each release takes about 1 GB of memory while its binaries are hashed.
const CONCURRENT_RELEASES = 8;
// The releases without an attestation. All later releases have one.
const AUTHENTICODE_RELEASES =
	"2.29.0 - 2.29.17 || 2.30.0 - 2.30.9 || 2.31.1 - 2.31.14 || 2.32.0 - 2.32.7";

const execFileAsync = promisify(execFile);

async function gh(...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		env: { ...process.env, GH_REPO: REPO },
		maxBuffer: 64 * 1024 * 1024,
	});
	return stdout.trim();
}

function api(endpoint: string, jq: string): Promise<string> {
	return gh("api", `repos/${REPO}/${endpoint}`, "--jq", jq);
}

function log(message: string): void {
	process.stderr.write(`${message}\n`);
}

/**
 * The digest of each CLI binary in the zstd-compressed tar that a Coder server
 * binary embeds, by binary name.
 */
export async function embeddedCliDigests(
	server: Buffer,
): Promise<Record<string, string>> {
	for (
		let at = server.indexOf(ZSTD_MAGIC);
		at >= 0;
		at = server.indexOf(ZSTD_MAGIC, at + 1)
	) {
		// parseTar reads the whole ArrayBuffer under a view, so give it its own.
		const tar = new Uint8Array(await decompressZstd(server.subarray(at)));
		const files = tarFiles(parseTar(tar));
		if (files.has("coder-linux-amd64")) {
			return Object.fromEntries(
				[...files]
					.filter(([name]) => CLI_BINARY.test(name))
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([name, data]) => [
						name,
						createHash("sha256").update(data).digest("hex"),
					]),
			);
		}
	}
	throw new Error("No CLI binaries in the server binary");
}

/** The regular files in a tar archive, by path without a leading "./". */
function tarFiles(entries: ParsedTarFileItem[]): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	for (const entry of entries) {
		if (entry.type === "file" && entry.data) {
			files.set(path.posix.normalize(entry.name), asBuffer(entry.data));
		}
	}
	return files;
}

/** A Buffer over the same memory, so a large binary is not copied. */
function asBuffer(data: Uint8Array): Buffer {
	return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** Whether `osslsigncode verify` output shows a verified signature by Coder. */
export function isSignedByCoder(verifyOutput: string): boolean {
	const signer = SIGNER_SUBJECT.exec(verifyOutput)?.[1];
	return (
		signer?.startsWith(CODER_SIGNER) === true && SIGNATURE_OK.test(verifyOutput)
	);
}

/**
 * The release version and commit in the build info that Go embeds in a Coder
 * binary, as `go version -m` prints them.
 */
export function buildInfo(binary: Buffer): {
	version?: string;
	commit?: string;
} {
	// A 32-byte header, then the Go version and the module info as
	// varint-prefixed strings when flag bit 2 is set (Go 1.18+).
	const header = binary.indexOf(GO_BUILDINFO_MAGIC);
	if (header < 0 || (binary[header + 15] & 2) === 0) {
		return {};
	}
	let offset = header + 32;
	const readString = () => {
		let length = 0;
		for (let shift = 0, byte = 0x80; byte >= 0x80; shift += 7) {
			byte = binary[offset++];
			length += (byte & 0x7f) * 2 ** shift;
		}
		offset += length;
		return binary.toString("utf8", offset - length, offset);
	};
	readString();
	const moduleInfo = readString();
	return {
		version: RELEASE_VERSION.exec(moduleInfo)?.[1],
		commit: COMMIT.exec(moduleInfo)?.[1],
	};
}

/** Decompress the zstd frames at the start of data, ignoring what follows. */
function decompressZstd(data: Buffer): Promise<Buffer> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		const stream = createZstdDecompress();
		stream.on("data", (chunk: Buffer) => chunks.push(chunk));
		// Bytes after the last frame are an error, but the frames before them
		// were already decompressed.
		stream.on("error", () => resolve(Buffer.concat(chunks)));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.end(data);
	});
}

async function download(tag: string, name: string, dir: string) {
	await gh("release", "download", tag, "--pattern", name, "--dir", dir);
	return path.join(dir, name);
}

/** Check that GitHub attests this linux_amd64 archive, and say how. */
async function attestation(tag: string, archive: string) {
	const provenance = await gh(
		"attestation",
		"verify",
		archive,
		`--repo=${REPO}`,
		`--signer-workflow=${REPO}/.github/workflows/release.yaml`,
		"--format=json",
		"--jq=.[0].verificationResult.signature.certificate | .sourceRepositoryRef, .sourceRepositoryDigest",
	).catch(() => undefined);
	if (!provenance) {
		await gh("release", "verify-asset", tag, archive);
		return "release asset attestation";
	}
	const [ref, commit] = provenance.split("\n");
	const branch = `release/${semver.major(tag)}.${semver.minor(tag)}`;
	if (ref !== `refs/tags/${tag}` && ref !== `refs/heads/${branch}`) {
		throw new Error(`Provenance is for ${ref}, not ${tag} or ${branch}`);
	}
	const status = await api(`compare/${commit}...${branch}`, ".status");
	if (status !== "identical" && status !== "ahead") {
		throw new Error(`Provenance commit ${commit} is not on ${branch}`);
	}
	return `provenance ${commit}`;
}

/** Check that Coder signed this coder.exe for the release, and say how. */
async function authenticode(tag: string, exe: Buffer, dir: string) {
	const exeFile = path.join(dir, "coder.exe");
	const caFile = path.join(dir, "roots.pem");
	await fs.writeFile(exeFile, exe);
	await fs.writeFile(caFile, rootCertificates.join("\n"));
	const args = [
		"verify",
		"-in",
		exeFile,
		"-CAfile",
		caFile,
		"-TSA-CAfile",
		caFile,
	];
	const { stdout } = await execFileAsync("osslsigncode", args).catch(() => ({
		stdout: "",
	}));
	if (!isSignedByCoder(stdout)) {
		throw new Error("No Authenticode signature by Coder");
	}
	const { version, commit } = buildInfo(exe);
	const tagCommit = await api(`commits/${tag}`, ".sha");
	if (`v${version}` !== tag || commit !== tagCommit) {
		throw new Error(`coder.exe was built as ${version} from ${commit}`);
	}
	return `Authenticode ${commit}`;
}

/** The release's server binary and what verified it. Throws if nothing does. */
async function verifiedServer(tag: string, dir: string) {
	const version = tag.slice(1);
	if (semver.satisfies(tag, AUTHENTICODE_RELEASES)) {
		const zip = await download(tag, `coder_${version}_windows_amd64.zip`, dir);
		const unzipped = unzipSync(await fs.readFile(zip), {
			filter: (file) => file.name === "coder.exe",
		});
		const exe = asBuffer(unzipped["coder.exe"]);
		return { server: exe, how: await authenticode(tag, exe, dir) };
	}
	const archive = await download(
		tag,
		`coder_${version}_linux_amd64.tar.gz`,
		dir,
	);
	const how = await attestation(tag, archive);
	const files = tarFiles(await parseTarGzip(await fs.readFile(archive)));
	const server = files.get("coder");
	if (!server) {
		throw new Error("No server binary in the linux_amd64 archive");
	}
	return { server, how };
}

/** The digests of a release's CLI binaries. Throws if nothing verifies them. */
async function releaseDigests(tag: string): Promise<Record<string, string>> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `coder-${tag}-`));
	try {
		const { server, how } = await verifiedServer(tag, dir);
		const binaries = await embeddedCliDigests(server);
		log(`${tag}: ${Object.keys(binaries).length} binaries (${how})`);
		return binaries;
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function main(minVersion: string): Promise<void> {
	const releases = await gh(
		"release",
		"list",
		"--exclude-pre-releases",
		"--limit=1000",
		"--json=tagName",
		"--jq=.[].tagName",
	);
	const tags = releases
		.split("\n")
		.filter((tag) => STABLE_TAG.test(tag) && semver.gte(tag, minVersion))
		.sort(semver.compare);

	const results = new Map<string, Record<string, string>>();
	const queue = [...tags];
	const worker = async () => {
		for (let tag = queue.shift(); tag; tag = queue.shift()) {
			try {
				results.set(tag, await releaseDigests(tag));
			} catch (error) {
				log(
					`${tag}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENT_RELEASES }, worker));

	const digests = Object.fromEntries(
		[...results]
			.sort(([a], [b]) => semver.compare(a, b))
			.map(([tag, binaries]) => [tag.slice(1), binaries]),
	);
	process.stdout.write(`${JSON.stringify(digests, null, "\t")}\n`);
	const skipped = tags.filter((tag) => !results.has(tag));
	log(`Not included: ${skipped.join(" ") || "none"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main(process.argv[2] ?? "2.29.0");
}
