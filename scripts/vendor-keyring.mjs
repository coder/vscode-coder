/**
 * Vendor @napi-rs/keyring into dist/node_modules/ for VSIX packaging.
 *
 * pnpm uses symlinks that vsce can't follow.  This script resolves them and
 * copies the JS wrapper plus macOS/Windows .node binaries into dist/, where
 * Node's require() resolution finds them from dist/extension.js.
 */
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const outputDir = resolve("dist/node_modules/@napi-rs/keyring");
const keyringPkg = resolve("node_modules/@napi-rs/keyring");

if (!existsSync(keyringPkg)) {
	console.log("@napi-rs/keyring not found, skipping");
	process.exit(0);
}

const resolvedPkg = realpathSync(keyringPkg);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(resolvedPkg, outputDir, { recursive: true });

// Platform packages are siblings of the resolved keyring package in pnpm's layout.
// Exact file names so the build fails loudly if the native module renames anything.
const siblingsDir = resolve(resolvedPkg, "..");
const binaries = [
	"keyring-darwin-arm64/keyring.darwin-arm64.node",
	"keyring-darwin-x64/keyring.darwin-x64.node",
	"keyring-win32-arm64-msvc/keyring.win32-arm64-msvc.node",
	"keyring-win32-x64-msvc/keyring.win32-x64-msvc.node",
];

for (const binary of binaries) {
	const symlink = join(siblingsDir, binary);
	if (!existsSync(symlink)) {
		console.error(
			`Missing native binary: ${binary}\n` +
				"Ensure .npmrc includes supportedArchitectures for all target OS/CPU combinations.",
		);
		process.exit(1);
	}
	const src = realpathSync(symlink);
	const filename = basename(binary);
	const dest = join(outputDir, filename);
	cpSync(src, dest);
}

console.log(
	`Vendored @napi-rs/keyring with ${binaries.length} platform binaries into dist/`,
);
