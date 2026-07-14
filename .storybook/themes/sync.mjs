#!/usr/bin/env node

/**
 * Captures the CSS custom properties and default webview stylesheet a real
 * VS Code instance injects into webviews, per built-in theme, into
 * ./generated. The capture logic in suite.cjs runs inside the extension
 * host; package.json here is the fixture extension manifest VS Code
 * requires. On headless environments: `xvfb-run -a pnpm sync:vscode-themes`.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runTests } from "@vscode/test-electron";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(HERE, "generated");

/** Pinned so dumps are reproducible; bump to resync against a newer VS Code. */
const VSCODE_VERSION = "1.128.0";

async function main() {
	// Isolated profile: theme switching must not touch the shared
	// .vscode-test user data used by the integration tests.
	const userDataDir = mkdtempSync(join(tmpdir(), "vscode-theme-sync-"));
	try {
		await runTests({
			version: VSCODE_VERSION,
			extensionDevelopmentPath: HERE,
			extensionTestsPath: join(HERE, "suite.cjs"),
			extensionTestsEnv: { THEME_SYNC_OUTPUT_DIR: OUTPUT_DIR },
			launchArgs: [
				"--disable-extensions",
				"--disable-gpu",
				"--user-data-dir",
				userDataDir,
			],
		});
		// The dump arrives with VS Code's source indentation; format it so a
		// resync never leaves a diff for format:check to reject.
		execFileSync(
			"pnpm",
			["exec", "prettier", "--write", join(OUTPUT_DIR, "default-styles.css")],
			{ cwd: resolve(HERE, "../.."), stdio: "inherit" },
		);
		console.log(`Snapshots written to ${OUTPUT_DIR}`);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
