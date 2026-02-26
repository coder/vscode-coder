/**
 * Vendor @napi-rs/keyring into dist/node_modules/ for VSIX packaging.
 *
 * pnpm uses symlinks that vsce can't follow. This script resolves them and
 * copies the JS wrapper plus macOS/Windows .node binaries into dist/, where
 * Node's require() resolution finds them from dist/extension.js.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

const keyringPkg = resolve("node_modules/@napi-rs/keyring");
const outputDir = resolve("dist/node_modules/@napi-rs/keyring");

if (!existsSync(keyringPkg)) {
	console.error("@napi-rs/keyring not found — run pnpm install first");
	process.exit(1);
}

// Copy the JS wrapper package (resolving pnpm symlinks)
const resolvedPkg = realpathSync(keyringPkg);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(resolvedPkg, outputDir, { recursive: true });

// Native binary packages live as siblings of the resolved keyring package in
// pnpm's content-addressable store (they aren't hoisted to node_modules).
const siblingsDir = resolve(resolvedPkg, "..");
const nativePackages = [
	"keyring-darwin-arm64",
	"keyring-darwin-x64",
	"keyring-win32-arm64-msvc",
	"keyring-win32-x64-msvc",
];

for (const pkg of nativePackages) {
	const pkgDir = join(siblingsDir, pkg);
	if (!existsSync(pkgDir)) {
		console.error(
			`Missing native package: ${pkg}\n` +
				"Ensure supportedArchitectures in pnpm-workspace.yaml includes all target platforms.",
		);
		process.exit(1);
	}
	const nodeFile = readdirSync(pkgDir).find((f) => f.endsWith(".node"));
	if (!nodeFile) {
		console.error(`No .node binary found in ${pkg}`);
		process.exit(1);
	}
	cpSync(join(pkgDir, nodeFile), join(outputDir, nodeFile));
}

console.log(
	`Vendored @napi-rs/keyring with ${nativePackages.length} platform binaries into dist/`,
);
