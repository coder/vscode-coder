#!/usr/bin/env node

/**
 * Downloads the coder/coder API client into ./site at upstream's paths, so
 * imports stay `coder/site/src/...`. Pulling a few files avoids installing
 * the whole repository as a git dependency.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** A release commit, with its tag alongside. Bump both to resync. */
const CODER_COMMIT = "22f4284f8fa67bc3af6fc38e0079616d39128566"; // v2.37.1

/** The modules we import, plus their relative imports. */
const FILES = [
	"site/src/api/api.ts",
	"site/src/api/errors.ts",
	"site/src/api/typesGenerated.ts",
	"site/src/utils/delay.ts",
	"site/src/utils/OneWayWebSocket.ts",
];

const contents = await Promise.all(
	FILES.map(async (file) => {
		const url = `https://raw.githubusercontent.com/coder/coder/${CODER_COMMIT}/${file}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download ${url}: ${response.status}`);
		}
		return response.text();
	}),
);

await rm(join(import.meta.dirname, "site"), { recursive: true, force: true });
for (const [i, file] of FILES.entries()) {
	const target = join(import.meta.dirname, file);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents[i]);
}
console.log(`Synced coder/coder ${CODER_COMMIT}`);
