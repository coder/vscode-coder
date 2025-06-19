import * as cp from "child_process";
import * as path from "path";

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		const extensionDevelopmentPath = path.resolve(__dirname, "../../");

		// The path to the extension test runner script
		const extensionTestsPath = path.resolve(__dirname, "./index");

		console.log("Running integration tests with coverage...");

		// Run tests with nyc for coverage
		const nycPath = path.join(
			extensionDevelopmentPath,
			"node_modules",
			".bin",
			"nyc",
		);

		const testProcess = cp.spawn(
			nycPath,
			[
				"--nycrc-path",
				path.join(extensionDevelopmentPath, ".nycrc.json"),
				"vscode-test",
			],
			{
				stdio: "inherit",
				cwd: extensionDevelopmentPath,
				env: {
					...process.env,
					VSCODE_TEST_PATH: extensionTestsPath,
				},
			},
		);

		testProcess.on("close", (code) => {
			if (code !== 0) {
				console.error(`Test process exited with code ${code}`);
				process.exit(code);
			} else {
				console.log("Tests completed successfully with coverage!");
				console.log(
					"Coverage report available at ./coverage-integration/index.html",
				);
			}
		});
	} catch (err) {
		console.error("Failed to run tests:", err);
		process.exit(1);
	}
}

main();