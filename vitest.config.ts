import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
		exclude: [
			"test/integration/**",
			"**/node_modules/**",
			"**/out/**",
			"**/*.d.ts",
		],
		pool: "threads",
		fileParallelism: true,
		coverage: {
			provider: "v8",
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@tests": path.resolve(__dirname, "test"),
			vscode: path.resolve(__dirname, "test/mocks/vscode.runtime.ts"),
		},
	},
});
