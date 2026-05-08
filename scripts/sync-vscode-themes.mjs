#!/usr/bin/env node

// Fetches dark-v2 and light-v2 theme files from vscode-elements/webview-playground
// and rewrites .storybook/themes/{dark,light}-v2.ts in place.
//
// Usage:
//   node scripts/sync-vscode-themes.mjs          # fetch latest main
//   node scripts/sync-vscode-themes.mjs <sha>    # fetch a specific commit

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "vscode-elements/webview-playground";
const BASE_URL = `https://raw.githubusercontent.com/${REPO}`;

const themes = [
	{
		remotePath: "dist/themes/dark-v2.js",
		localPath: ".storybook/themes/dark-v2.ts",
		exportName: "darkTheme",
	},
	{
		remotePath: "dist/themes/light-v2.js",
		localPath: ".storybook/themes/light-v2.ts",
		exportName: "lightTheme",
	},
];

async function resolveLatestSha() {
	const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
		headers: { Accept: "application/vnd.github.sha" },
	});
	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
	}
	return (await res.text()).trim();
}

async function fetchTheme(sha, remotePath) {
	const url = `${BASE_URL}/${sha}/${remotePath}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}
	return res.text();
}

// The upstream JS files export a default array of [property, value] tuples.
// Strip the JS export wrapper and re-emit as a typed TypeScript constant.
function toTypeScript(jsSource, sha, remotePath, exportName) {
	// Find the array that follows `export const theme =`
	const exportMatch = jsSource.match(/export\s+const\s+theme\s*=\s*/);
	if (!exportMatch) {
		throw new Error("Could not find `export const theme` in upstream source");
	}
	const afterExport = jsSource.slice(exportMatch.index + exportMatch[0].length);
	const start = afterExport.indexOf("[");
	const end = afterExport.lastIndexOf("]");
	if (start === -1 || end === -1) {
		throw new Error("Could not locate array literal in upstream source");
	}
	const arrayLiteral = afterExport.slice(start, end + 1);

	// The upstream source escapes dots in CSS property names (e.g.
	// `disabled\.background`). These are unnecessary in JS strings and
	// would break setProperty lookups, so strip them.
	const cleaned = arrayLiteral.replaceAll("\\.", ".");

	const header = [
		`// Sourced from \`vscode-elements/webview-playground\`.`,
		`// https://github.com/${REPO}/blob/${sha}/${remotePath}`,
	].join("\n");

	return `${header}\n\nexport const ${exportName}: Array<[string, string]> = ${cleaned};\n`;
}

const sha = process.argv[2] ?? (await resolveLatestSha());
console.log(`Syncing themes from ${REPO}@${sha}`);

for (const { remotePath, localPath, exportName } of themes) {
	const js = await fetchTheme(sha, remotePath);
	const ts = toTypeScript(js, sha, remotePath, exportName);
	const dest = resolve(ROOT, localPath);
	writeFileSync(dest, ts);
	console.log(`  ${localPath}`);
}

console.log("Done. Run `pnpm format` to normalize the output.");
