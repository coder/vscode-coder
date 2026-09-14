import * as os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: import.meta.dirname,
	cacheDir: path.join(os.tmpdir(), "windows-acl-vitest-cache"),
	test: {
		cache: false,
		environment: "node",
		include: ["**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@prototype": path.resolve(import.meta.dirname, ".."),
		},
	},
});
