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
	target: "node22",
	format: "cjs",
	mainFields: ["module", "main"],
	external: ["vscode", "openpgp"],
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
