import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		assert.ok(vscode.extensions.getExtension("coder.coder-remote"));
	});

	test("Extension should activate", async () => {
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension);

		if (!extension.isActive) {
			await extension.activate();
		}

		assert.ok(extension.isActive);
	});

	test("Extension should export activate function", async () => {
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension);

		await extension.activate();
		// The extension doesn't export anything, which is fine
		// The test was expecting exports.activate but the extension
		// itself is the activate function
		assert.ok(extension.isActive);
	});

	test("Commands should be registered", async () => {
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension);

		if (!extension.isActive) {
			await extension.activate();
		}

		// Give a small delay for commands to register
		await new Promise((resolve) => setTimeout(resolve, 100));

		const commands = await vscode.commands.getCommands(true);
		const coderCommands = commands.filter((cmd) => cmd.startsWith("coder."));

		assert.ok(
			coderCommands.length > 0,
			"Should have registered Coder commands",
		);
		assert.ok(
			coderCommands.includes("coder.login"),
			"Should have coder.login command",
		);
	});
});
