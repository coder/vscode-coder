/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"**/*.test.ts",
				"**/*.spec.ts",
				"**/test/**",
				"**/*.d.ts",
				"vitest.config.ts",
				"webpack.config.js",
			],
			include: ["src/**/*.ts"],
			all: true,
			clean: true,
		},
	},
});
