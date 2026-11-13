import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

/** Separate from the root config so `pnpm test` never needs a live server. */
export default defineConfig({
	root,
	resolve: {
		// Keep in sync with the root config's extension project.
		alias: {
			"@": path.join(root, "src"),
			"@repo/webview-shared": path.join(root, "packages/webview-shared/src"),
			vscode: path.join(root, "test/mocks/vscode.runtime.ts"),
		},
	},
	test: {
		include: ["test/scopes/**/*.test.ts"],
		environment: "node",
		// Long enough for provisioner jobs.
		testTimeout: 120_000,
		hookTimeout: 300_000,
	},
});
