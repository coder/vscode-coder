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
			reporter: ["text", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/test/**",
				"src/**/*.d.ts",
			],
		},
	},
});
