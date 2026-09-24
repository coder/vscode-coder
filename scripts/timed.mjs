import { spawnSync } from "node:child_process";

import { resolveBin } from "./resolve-bin.mjs";

const [command, ...args] = process.argv.slice(2);
const start = performance.now();
const result = spawnSync(process.execPath, [resolveBin(command), ...args], {
	stdio: "inherit",
});
const seconds = ((performance.now() - start) / 1000).toFixed(1);
console.log(`${command} finished in ${seconds}s`);
process.exit(result.status ?? 1);
