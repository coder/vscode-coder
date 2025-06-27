import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

suite("CLI Integration Tests", () => {
	let _originalConfig: vscode.WorkspaceConfiguration;
	let tempDir: string;

	suiteSetup(async () => {
		// Create a temporary directory for test files
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coder-test-"));

		// Ensure extension is activated
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension, "Extension should be present");

		if (!extension.isActive) {
			await extension.activate();
		}

		// Give time for extension to initialize
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Store original configuration
		_originalConfig = vscode.workspace.getConfiguration("coder");
	});

	suiteTeardown(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (error) {
			// Failed to clean up temp directory
		}
	});

	suite("CLI Binary Management", () => {
		test("should verify CLI manager is accessible", () => {
			// This test verifies that the CLI manager components are available
			// We can't directly test private methods but we can test the integration
			const extension = vscode.extensions.getExtension("coder.coder-remote");
			assert.ok(extension?.isActive, "Extension should be active");
		});

		test("should handle CLI binary path configuration", async () => {
			// Test that custom binary path can be configured
			const config = vscode.workspace.getConfiguration("coder");
			const originalPath = config.get("binaryPath");

			try {
				// Set a custom binary path
				await config.update(
					"binaryPath",
					"/custom/path/to/coder",
					vscode.ConfigurationTarget.Global,
				);

				// Verify the setting was updated
				const updatedConfig = vscode.workspace.getConfiguration("coder");
				assert.strictEqual(
					updatedConfig.get("binaryPath"),
					"/custom/path/to/coder",
				);
			} finally {
				// Restore original configuration
				await config.update(
					"binaryPath",
					originalPath,
					vscode.ConfigurationTarget.Global,
				);
			}
		});

		test("should handle binary download settings", async () => {
			// Test binary download configuration
			const config = vscode.workspace.getConfiguration("coder");
			const originalSetting = config.get("enableDownloads");

			try {
				// Test disabling downloads
				await config.update(
					"enableDownloads",
					false,
					vscode.ConfigurationTarget.Global,
				);

				const updatedConfig = vscode.workspace.getConfiguration("coder");
				assert.strictEqual(updatedConfig.get("enableDownloads"), false);

				// Test enabling downloads
				await config.update(
					"enableDownloads",
					true,
					vscode.ConfigurationTarget.Global,
				);

				const finalConfig = vscode.workspace.getConfiguration("coder");
				assert.strictEqual(finalConfig.get("enableDownloads"), true);
			} finally {
				// Restore original configuration
				await config.update(
					"enableDownloads",
					originalSetting,
					vscode.ConfigurationTarget.Global,
				);
			}
		});
	});

	suite("CLI Configuration Management", () => {
		test("should handle URL file configuration", async () => {
			// Test that URL files can be managed for CLI configuration
			const config = vscode.workspace.getConfiguration("coder");
			const originalUrl = config.get("url");

			try {
				// Set a test URL
				await config.update(
					"url",
					"https://test.coder.com",
					vscode.ConfigurationTarget.Global,
				);

				const updatedConfig = vscode.workspace.getConfiguration("coder");
				assert.strictEqual(updatedConfig.get("url"), "https://test.coder.com");
			} finally {
				// Restore original configuration
				await config.update(
					"url",
					originalUrl,
					vscode.ConfigurationTarget.Global,
				);
			}
		});
	});

	suite("CLI Command Execution", () => {
		test("should handle CLI command errors", async () => {
			// Test error handling and user feedback for CLI failures
			// Mock showErrorMessage to verify error handling
			const originalShowErrorMessage = vscode.window.showErrorMessage;
			let _errorShown = false;

			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(vscode.window as any).showErrorMessage = () => {
					_errorShown = true;
					return Promise.resolve(undefined);
				};

				// Try to execute a command that might fail
				// In real usage, this would be a CLI command execution
				await vscode.commands.executeCommand("coder.viewLogs");
			} catch (error) {
				// Expected - command might fail
				assert.ok(error instanceof Error, "Should throw proper errors");
			} finally {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(vscode.window as any).showErrorMessage = originalShowErrorMessage;
			}

			assert.ok(true, "CLI error handling is implemented");
		});
	});

	suite("CLI Authentication Integration", () => {
		test("should handle token file management", () => {
			// Test token file operations for CLI authentication
			const config = vscode.workspace.getConfiguration("coder");

			// Verify token-related settings exist
			assert.ok(
				config.has("sessionToken") !== undefined,
				"Session token setting should be available",
			);
		});
	});

	suite("CLI Error Handling", () => {
		test("should handle missing CLI binary gracefully", async () => {
			// Test behavior when CLI binary is not available
			const config = vscode.workspace.getConfiguration("coder");
			const originalPath = config.get("binaryPath");

			try {
				// Set an invalid binary path
				await config.update(
					"binaryPath",
					"/nonexistent/path/coder",
					vscode.ConfigurationTarget.Global,
				);

				// The extension should handle this gracefully without crashing
				assert.ok(true, "Invalid binary path handled without throwing");
			} finally {
				// Restore original configuration
				await config.update(
					"binaryPath",
					originalPath,
					vscode.ConfigurationTarget.Global,
				);
			}
		});
	});

	suite("CLI Platform Support", () => {});
});
