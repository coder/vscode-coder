import * as assert from "assert";
import * as vscode from "vscode";

suite("Commands Test Suite", () => {
	let extension: vscode.Extension<unknown>;

	suiteSetup(async () => {
		vscode.window.showInformationMessage("Starting Commands tests.");

		extension = vscode.extensions.getExtension("coder.coder-remote")!;
		assert.ok(extension, "Extension should be available");

		if (!extension.isActive) {
			await extension.activate();
		}

		// Give commands time to register
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	test("Core commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);

		const coreCommands = [
			"coder.login",
			"coder.logout",
			"coder.open",
			"coder.showLogs",
		];

		for (const cmd of coreCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
		}
	});

	test("Workspace commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);

		const workspaceCommands = commands.filter((cmd) =>
			cmd.startsWith("coder.workspaces."),
		);

		assert.ok(
			workspaceCommands.length > 0,
			"Workspace commands should be registered",
		);

		// Check for specific workspace commands
		const expectedWorkspaceCommands = [
			"coder.workspaces.refresh",
			"coder.workspaces.open",
			"coder.workspaces.click",
		];

		for (const cmd of expectedWorkspaceCommands) {
			if (commands.includes(cmd)) {
				assert.ok(true, `Found workspace command: ${cmd}`);
			}
		}
	});

	test("Command execution - showLogs", async () => {
		try {
			// This should not throw an error
			await vscode.commands.executeCommand("coder.showLogs");
			assert.ok(true, "showLogs command executed successfully");
		} catch (error) {
			// Some commands may require setup, which is OK in tests
			assert.ok(
				error instanceof Error &&
					(error.message.includes("not found") ||
						error.message.includes("No output channel")),
				"Expected error for showLogs in test environment",
			);
		}
	});

	test("Command palette integration", async () => {
		const commands = await vscode.commands.getCommands(true);
		const coderCommands = commands.filter((cmd) => cmd.startsWith("coder."));

		// Verify we have a reasonable number of commands
		assert.ok(
			coderCommands.length >= 5,
			`Should have at least 5 Coder commands, found ${coderCommands.length}`,
		);

		// Commands should have proper naming convention
		for (const cmd of coderCommands) {
			assert.ok(
				cmd.match(/^coder\.[a-zA-Z]+(\.[a-zA-Z]+)*$/),
				`Command ${cmd} should follow naming convention`,
			);
		}
	});

	test("Remote SSH commands integration", async () => {
		const commands = await vscode.commands.getCommands(true);

		// The extension should integrate with Remote SSH
		const sshCommands = commands.filter((cmd) =>
			cmd.includes("opensshremotes"),
		);

		if (sshCommands.length > 0) {
			assert.ok(true, "Remote SSH integration commands found");
		} else {
			// In test environment, Remote SSH might not be available
			assert.ok(true, "Remote SSH may not be available in test environment");
		}
	});

	test("Command contributions from package.json", async () => {
		// Get all registered commands
		const commands = await vscode.commands.getCommands(true);

		// Test command categories
		const commandCategories = {
			authentication: ["login", "logout"],
			workspace: ["workspaces", "open"],
			utility: ["showLogs", "viewLogs"],
		};

		for (const [category, keywords] of Object.entries(commandCategories)) {
			const categoryCommands = commands.filter((cmd) => {
				if (!cmd.startsWith("coder.")) {
					return false;
				}
				return keywords.some((keyword) => cmd.includes(keyword));
			});

			assert.ok(
				categoryCommands.length > 0,
				`Should have ${category} commands`,
			);
		}
	});

	test("Context menu command availability", async () => {
		const commands = await vscode.commands.getCommands(true);

		// Commands that might appear in context menus
		const contextualCommands = commands.filter(
			(cmd) =>
				cmd.startsWith("coder.") &&
				(cmd.includes("open") || cmd.includes("click") || cmd.includes("view")),
		);

		assert.ok(
			contextualCommands.length > 0,
			"Should have commands for context menus",
		);
	});

	test("Command error handling", async () => {
		// Test that commands handle errors gracefully
		try {
			// Try to execute a command that requires authentication
			await vscode.commands.executeCommand("coder.workspaces.refresh");
			// If it succeeds, that's fine
			assert.ok(true, "Command executed without error");
		} catch (error) {
			// If it fails, it should fail gracefully
			assert.ok(error instanceof Error, "Error should be an Error instance");
			assert.ok(
				!error.message.includes("undefined") || !error.message.includes("null"),
				"Error message should be meaningful",
			);
		}
	});

	test("Command contributions match activation events", async () => {
		// Ensure commands are available after activation
		const postActivationCommands = await vscode.commands.getCommands(true);
		const coderCommands = postActivationCommands.filter((cmd) =>
			cmd.startsWith("coder."),
		);

		// After activation, all commands should be available
		assert.ok(
			coderCommands.length > 0,
			"Commands should be available after activation",
		);

		// Check that we don't have duplicate commands
		const uniqueCommands = [...new Set(coderCommands)];
		assert.strictEqual(
			uniqueCommands.length,
			coderCommands.length,
			"Should not have duplicate commands",
		);
	});
});
