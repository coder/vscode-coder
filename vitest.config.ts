import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["test/unit/**/*.test.ts", "test/utils/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/out/**", "**/*.d.ts"],
		pool: "threads",
		fileParallelism: true,
		coverage: {
			provider: "v8",
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			vscode: path.resolve(__dirname, "test/mocks/vscode.runtime.ts"),
		},
	},
});
