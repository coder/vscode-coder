/* global process */

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execute = promisify(execFile);

function createBridge({
	variant,
	artifactRoot,
	platform = process.platform,
	arch = process.arch,
	loadAddon = require,
	runHelper = execute,
}) {
	if (!["helper", "addon"].includes(variant)) {
		throw new Error(`Unknown ACL prototype: ${variant}`);
	}
	let addon;
	async function invoke(operation, target) {
		// No native resolution, loading, or execution outside Windows.
		if (platform !== "win32") return { skipped: true };
		if (!["x64", "arm64"].includes(arch)) {
			throw new Error(`Unsupported Windows architecture: ${arch}`);
		}
		if (!path.win32.isAbsolute(target) || target.includes("\0")) {
			throw new Error("An absolute Windows path without NUL is required");
		}
		const directory = path.join(artifactRoot, `win32-${arch}`);
		if (variant === "addon") {
			addon ??= loadAddon(path.join(directory, "acl.node"));
			return addon[operation](target);
		}
		const { stdout } = await runHelper(
			path.join(directory, "acl-helper.exe"),
			[operation, target],
			{ windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
		);
		const result = JSON.parse(stdout);
		if (
			result.version !== 1 ||
			result.ok !== true ||
			(operation === "inspect" && typeof result.sddl !== "string")
		) {
			throw new Error("Invalid ACL helper response");
		}
		return operation === "inspect" ? result.sddl : undefined;
	}
	return {
		secure: (target) => invoke("secure", target),
		inspect: (target) => invoke("inspect", target),
	};
}

module.exports = { createBridge };
