import { globSync, rmSync } from "node:fs";

// Generated files to delete, as paths or globs from the repo root.
const PATTERNS = [
	"node_modules",
	"packages/*/node_modules",
	"dist",
	"out",
	"storybook-static",
	"coverage",
	".vscode-test",
	".pnpm-store",
	"*.vsix",
	"*.log",
];

for (const path of globSync(PATTERNS)) {
	rmSync(path, { recursive: true, force: true });
}
