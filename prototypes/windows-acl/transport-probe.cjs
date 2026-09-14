/* global __dirname, console, process */

// Explicit development probe only: loads Linux artifacts to test the interfaces.
// The application bridge never loads native code on Linux or macOS.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { copyFileSync, mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
	if (process.platform !== "linux") {
		throw new Error("This transport-only probe expects Linux build artifacts");
	}
	const release = path.join(__dirname, "target", "release");
	const scratch = mkdtempSync(path.join(os.tmpdir(), "acl-transport-"));
	try {
		const binary = path.join(release, "acl-prototype-helper");
		const result = JSON.parse(
			execFileSync(binary, ["probe"], { encoding: "utf8" }),
		);
		assert.equal(result.version, 1);
		assert.equal(result.backend, "unsupported");
		assert.throws(
			() => execFileSync(binary, ["secure", scratch], { stdio: "pipe" }),
			(error) => {
				const response = JSON.parse(error.stderr.toString());
				return error.status === 1 && response.kind === "Unsupported";
			},
		);
		const modulePath = path.join(scratch, "acl.node");
		copyFileSync(path.join(release, "libacl_prototype_addon.so"), modulePath);
		const addon = require(modulePath);
		assert.equal(addon.probe(), "unsupported");
		await assert.rejects(addon.secure(scratch), /unsupported/);
		await assert.rejects(addon.inspect(scratch), /unsupported/);
		console.log(
			JSON.stringify(
				{
					platform: process.platform,
					node: process.versions.node,
					electron: process.versions.electron ?? null,
					napi: process.versions.napi,
					helper: "probe and unsupported error passed",
					addon: "load, probe, async unsupported errors passed",
					windowsAclValidated: false,
				},
				null,
				2,
			),
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
