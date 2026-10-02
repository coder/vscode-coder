import path from "node:path";
import { defineConfig } from "vitest/config";

const webviewSharedAlias = path.resolve(
	import.meta.dirname,
	"packages/webview-shared/src",
);

/** Resolves extension source, with `vscode` replaced by the runtime mock. */
const extensionAlias = {
	"@": path.resolve(import.meta.dirname, "src"),
	"@repo/webview-shared": webviewSharedAlias,
	vscode: path.resolve(import.meta.dirname, "test/mocks/vscode.runtime.ts"),
};

// NTFS is slow with many small-file writes; double the default on Windows CI.
const testTimeout = process.platform === "win32" ? 10_000 : 5_000;

export default defineConfig({
	test: {
		testTimeout,
		globalSetup: "./test/env-check.ts",
		projects: [
			{
				extends: true,
				test: {
					name: "extension",
					include: ["test/unit/**/*.test.ts", "test/utils/**/*.test.ts"],
					exclude: ["**/node_modules/**", "**/out/**", "**/*.d.ts"],
					environment: "node",
					globals: true,
				},
				resolve: { alias: extensionAlias },
			},
			{
				extends: true,
				test: {
					name: "scopes",
					include: ["test/scopes/**/*.test.ts"],
					environment: "node",
					// Upper bounds for provisioner jobs; nothing waits on a timer.
					testTimeout: 120_000,
					hookTimeout: 300_000,
				},
				resolve: { alias: extensionAlias },
			},
			{
				extends: true,
				test: {
					name: "webview",
					include: ["test/webview/**/*.test.{ts,tsx}"],
					exclude: ["**/node_modules/**", "**/out/**", "**/*.d.ts"],
					environment: "jsdom",
					globals: true,
					setupFiles: ["test/webview/setup.ts"],
				},
				resolve: {
					alias: {
						"@repo/webview-shared": webviewSharedAlias,
						"@repo/tasks": path.resolve(
							import.meta.dirname,
							"packages/tasks/src",
						),
						"@repo/ui": path.resolve(import.meta.dirname, "packages/ui/src"),
						"@repo/workspaces": path.resolve(
							import.meta.dirname,
							"packages/workspaces/src",
						),
						"@repo/netcheck": path.resolve(
							import.meta.dirname,
							"packages/netcheck/src",
						),
						"@repo/speedtest": path.resolve(
							import.meta.dirname,
							"packages/speedtest/src",
						),
					},
				},
			},
		],
		coverage: {
			provider: "v8",
		},
	},
});
