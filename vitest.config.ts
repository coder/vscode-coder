import path from "node:path";
import { defineConfig } from "vitest/config";

const webviewSharedAlias = path.resolve(
	__dirname,
	"packages/webview-shared/src",
);

// NTFS is slow with many small-file writes; double the default on Windows CI.
const testTimeout = process.platform === "win32" ? 10_000 : 5_000;

export default defineConfig({
	test: {
		testTimeout,
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
				resolve: {
					alias: {
						"@": path.resolve(__dirname, "src"),
						"@repo/webview-shared": webviewSharedAlias,
						vscode: path.resolve(__dirname, "test/mocks/vscode.runtime.ts"),
					},
				},
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
						"@repo/tasks": path.resolve(__dirname, "packages/tasks/src"),
						"@repo/speedtest": path.resolve(
							__dirname,
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
