import { defineConfig } from "@vscode/test-cli";

// VS Code to Electron/Node version mapping:
//   VS Code 1.106 (Oct 2025) -> Electron 37, Node 22 - Minimum supported
//   VS Code stable             -> Latest
// See https://github.com/ewanharris/vscode-versions for version mapping
const versions = ["1.106.0", "stable"];

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
