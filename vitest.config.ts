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
		env: {
			NODE_ENV: "test",
		  },
	},
});
