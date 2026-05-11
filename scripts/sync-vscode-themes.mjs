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

async function fetchText(url, headers) {
	const res = await fetch(url, { headers });
	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}
	return res.text();
}

const sha =
	process.argv[2] ??
	(
		await fetchText(`https://api.github.com/repos/${REPO}/commits/main`, {
			Accept: "application/vnd.github.sha",
		})
	).trim();

console.log(`Syncing themes from ${REPO}@${sha}`);

await Promise.all(
	themes.map(async ({ remotePath, localPath, exportName }) => {
		const js = await fetchText(
			`https://raw.githubusercontent.com/${REPO}/${sha}/${remotePath}`,
		);
		const match = js.match(/export\s+const\s+theme\s*=\s*(\[[\s\S]*\])/);
		if (!match) {
			throw new Error(`Could not find theme array in ${remotePath}`);
		}
		// Upstream escapes dots in CSS property names (e.g. `disabled\.background`).
		// These are unnecessary in JS strings and break setProperty lookups.
		const arrayLiteral = match[1].replaceAll("\\.", ".");

		const ts = `// Sourced from \`vscode-elements/webview-playground\`.
// https://github.com/${REPO}/blob/${sha}/${remotePath}

export const ${exportName}: Array<[string, string]> = ${arrayLiteral};
`;
		writeFileSync(resolve(ROOT, localPath), ts);
		console.log(`  ${localPath}`);
	}),
);

console.log("Done. Run `pnpm format` to normalize the output.");
