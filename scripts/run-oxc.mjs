import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Oxlint and Oxfmt default to one thread per core. Above ~32 cores the
 * per-thread startup cost outweighs the parallelism it buys (oxc#21672).
 * Cap rather than pin so smaller machines and CI keep their optimal count.
 */
const MAX_THREADS = 8;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [tool, ...args] = process.argv.slice(2);

/* Resolve through the local bin directory so Windows shims work. */
const binary = join(repoRoot, "node_modules", ".bin", tool);
const threads = String(Math.min(availableParallelism(), MAX_THREADS));

const result = spawnSync(binary, [...args, "--threads", threads], {
	cwd: process.cwd(),
	stdio: "inherit",
});

process.exit(result.status ?? 1);
