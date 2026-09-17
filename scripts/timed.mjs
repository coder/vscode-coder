import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
const start = performance.now();
const result = spawnSync(command, args, { stdio: "inherit" });
const seconds = ((performance.now() - start) / 1000).toFixed(1);
console.log(`${command} finished in ${seconds}s`);
process.exit(result.status ?? 1);
