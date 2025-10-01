import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
	files: "out/test/integration/**/*.test.js",
	extensionDevelopmentPath: ".",
	extensionTestsPath: "./out/test",
	launchArgs: ["--enable-proposed-api", "coder.coder-remote"],
	mocha: {
		ui: "tdd",
		timeout: 20000,
	},
});
