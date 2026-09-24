import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";

import { resolveBin } from "./resolve-bin.mjs";

/*
 * Oxlint and Oxfmt default to one thread per core. Above ~32 cores the
 * per-thread startup cost outweighs the parallelism it buys (oxc#21672).
 * Cap rather than pin so smaller machines and CI keep their optimal count.
 */
const MAX_THREADS = 8;

const [tool, ...args] = process.argv.slice(2);
const threads = String(Math.min(availableParallelism(), MAX_THREADS));

const result = spawnSync(
	process.execPath,
	[resolveBin(tool), ...args, "--threads", threads],
	{ stdio: "inherit" },
);

process.exit(result.status ?? 1);
