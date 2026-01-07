import { defineConfig } from "@vscode/test-cli";

// VS Code to Electron/Node version mapping:
//   VS Code 1.95  (Oct 2024) -> Node 20 - Minimum supported
//   VS Code stable           -> Latest
const versions = ["1.95.0", "stable"];

const baseConfig = {
	files: "out/test/integration/**/*.test.js",
	extensionDevelopmentPath: ".",
	extensionTestsPath: "./out/test",
	launchArgs: ["--enable-proposed-api", "coder.coder-remote"],
	mocha: {
		ui: "tdd",
		timeout: 20000,
	},
};

export default defineConfig(
	versions.map((version) => ({
		...baseConfig,
		version,
		label: `VS Code ${version}`,
	})),
);
