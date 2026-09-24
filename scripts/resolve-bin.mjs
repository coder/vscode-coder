import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Run with `process.execPath`; `.bin` shims are `.cmd` on Windows, which spawn cannot run. */
export function resolveBin(tool) {
	const manifestPath = require.resolve(`${tool}/package.json`);
	const { bin } = require(manifestPath);
	return join(dirname(manifestPath), typeof bin === "string" ? bin : bin[tool]);
}
