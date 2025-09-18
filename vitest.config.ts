import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/out/**",
			"**/src/test/**",
			"src/test/**",
			"./src/test/**",
		],
		environment: "node",
		coverage: {
			provider: "v8",
		},
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "src/__mocks__/vscode.runtime.ts"),
		},
	},
});
