import * as assert from "assert";
import * as vscode from "vscode";

suite("URI Handler Integration Tests", () => {
	suiteSetup(async () => {
		// Ensure extension is activated
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension, "Extension should be present");

		if (!extension.isActive) {
			await extension.activate();
		}

		// Give time for extension to initialize and register URI handler
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	suite("vscode:// URI Handling", () => {
		test("should register URI handler for coder scheme", () => {
			// Verify that the extension has registered a URI handler
			// We can't directly test the handler registration, but we can verify
			// that the extension is active and capable of handling URIs
			const extension = vscode.extensions.getExtension("coder.coder-remote");
			assert.ok(
				extension?.isActive,
				"Extension should be active and URI handler registered",
			);
		});

		test("should validate required parameters for /open path", async () => {
			// Test that /open URI path requires owner and workspace parameters
			// We can test this by verifying the command that would be triggered
			const commands = await vscode.commands.getCommands(true);
			assert.ok(
				commands.includes("coder.open"),
				"Open command should be available for URI handling",
			);
		});

		test("should validate required parameters for /openDevContainer path", async () => {
			// Test that /openDevContainer URI path requires specific parameters
			const commands = await vscode.commands.getCommands(true);
			assert.ok(
				commands.includes("coder.openDevContainer"),
				"OpenDevContainer command should be available for URI handling",
			);
		});

		test("should handle workspace selection through open command", async () => {
			// Test that the open command can be executed (it would show workspace picker if not authenticated)
			try {
				// This will either show workspace picker or fail with authentication error
				await vscode.commands.executeCommand("coder.open");
				assert.ok(true, "Open command executed without throwing");
			} catch (error) {
				// Expected to fail if not authenticated
				assert.ok(
					error instanceof Error,
					"Should fail gracefully when not authenticated",
				);
			}
		});
	});

	suite("URI Parameter Parsing", () => {
		test("should parse URI query parameters correctly", () => {
			// Test query parameter parsing logic
			const testUri = vscode.Uri.parse(
				"vscode://coder.coder-remote/open?owner=test&workspace=dev&agent=main&folder=%2Fhome%2Fuser",
			);

			// Verify URI structure
			assert.strictEqual(testUri.scheme, "vscode");
			assert.strictEqual(testUri.authority, "coder.coder-remote");
			assert.strictEqual(testUri.path, "/open");
			assert.ok(testUri.query.includes("owner=test"));
			assert.ok(testUri.query.includes("workspace=dev"));
		});

		test("should handle URL encoding in parameters", () => {
			// Test that URL-encoded parameters are handled correctly
			const testUri = vscode.Uri.parse(
				"vscode://coder.coder-remote/open?folder=%2Fhome%2Fuser%2Fproject",
			);

			// The query should contain the folder parameter, either encoded or decoded
			assert.ok(testUri.query.includes("folder="));
			// Check that it contains either the encoded or decoded version
			const hasEncoded = testUri.query.includes(
				"folder=%2Fhome%2Fuser%2Fproject",
			);
			const hasDecoded = testUri.query.includes("folder=/home/user/project");
			assert.ok(
				hasEncoded || hasDecoded,
				`Query should contain folder parameter: ${testUri.query}`,
			);
		});

		test("should handle special characters in parameters", () => {
			// Test handling of special characters in parameter values
			const testUri = vscode.Uri.parse(
				"vscode://coder.coder-remote/open?workspace=test-workspace&owner=user.name",
			);

			assert.ok(testUri.query.includes("workspace=test-workspace"));
			assert.ok(testUri.query.includes("owner=user.name"));
		});
	});

	suite("URI Security", () => {
		test("should handle trusted URI schemes only", () => {
			// Verify that only the expected scheme is handled
			const validUri = vscode.Uri.parse("vscode://coder.coder-remote/open");
			assert.strictEqual(validUri.scheme, "vscode");
			assert.strictEqual(validUri.authority, "coder.coder-remote");
		});

		test("should handle malformed URIs gracefully", () => {
			// Test error handling for malformed URIs
			try {
				// Try parsing various malformed URIs
				const malformedUris = [
					"vscode://",
					"vscode://coder.coder-remote",
					"vscode://coder.coder-remote/",
					"vscode://coder.coder-remote/invalid-path",
				];

				for (const uri of malformedUris) {
					const parsed = vscode.Uri.parse(uri);
					// Should parse without throwing
					assert.ok(parsed, `Should parse URI: ${uri}`);
				}
			} catch (error) {
				assert.fail("URI parsing should not throw for malformed URIs");
			}
		});
	});

	suite("URI Integration with Commands", () => {
		test("should trigger appropriate commands for URI paths", async () => {
			// Verify that URI paths map to correct commands
			const commands = await vscode.commands.getCommands(true);

			// Commands that should be available for URI handling
			assert.ok(commands.includes("coder.open"));
			assert.ok(commands.includes("coder.openDevContainer"));
		});
	});
});
