// @ts-check
import { context, build } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").Plugin} */
const logRebuildPlugin = {
	name: "log-rebuild",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) {
				console.error(`Build failed with ${result.errors.length} error(s)`);
			} else {
				console.log(`Build succeeded at ${new Date().toLocaleTimeString()}`);
			}
		});
	},
};

/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.js",
	platform: "node",
	target: "node20",
	format: "cjs",
	mainFields: ["module", "main"],
	// Force openpgp to use CJS. The ESM version uses import.meta.url which is
	// undefined when bundled to CJS, causing runtime errors.
	alias: {
		openpgp: "./node_modules/openpgp/dist/node/openpgp.min.cjs",
	},
	external: ["vscode"],
	sourcemap: production ? "external" : true,
	minify: production,
	plugins: watch ? [logRebuildPlugin] : [],
	loader: {
		".sh": "text",
		".ps1": "text",
	},
};

async function main() {
	if (watch) {
		const ctx = await context(buildOptions);
		await ctx.watch();
	} else {
		await build(buildOptions);
	}
}

try {
	await main();
} catch (err) {
	console.error(err);
	process.exit(1);
}
