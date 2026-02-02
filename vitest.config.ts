import path from "node:path";
import { defineConfig } from "vitest/config";

const webviewSharedAlias = path.resolve(
	__dirname,
	"packages/webview-shared/src",
);

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "extension",
					include: ["test/unit/**/*.test.ts", "test/utils/**/*.test.ts"],
					exclude: ["**/node_modules/**", "**/out/**", "**/*.d.ts"],
					environment: "node",
					globals: true,
					pool: "threads",
					fileParallelism: true,
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
					pool: "threads",
					fileParallelism: true,
				},
				resolve: {
					alias: {
						"@repo/webview-shared": webviewSharedAlias,
					},
				},
			},
		],
		coverage: {
			provider: "v8",
		},
	},
});
