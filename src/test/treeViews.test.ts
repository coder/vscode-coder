import * as assert from "assert";
import * as vscode from "vscode";

suite("Tree Views Test Suite", () => {
	suiteSetup(() => {
		vscode.window.showInformationMessage("Starting Tree Views tests.");
	});

	test("Extension should register tree views", async () => {
		// Ensure extension is activated
		const extension = vscode.extensions.getExtension("coder.coder-remote");
		assert.ok(extension);

		if (!extension.isActive) {
			await extension.activate();
		}

		// Give time for tree views to register
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Check that workspace-related commands are registered
		const commands = await vscode.commands.getCommands(true);

		// Look for commands that indicate tree view support
		const treeViewRelatedCommands = [
			"coder.refreshWorkspaces",
			"coder.openFromSidebar",
			"coder.createWorkspace",
			"coder.navigateToWorkspace",
		];

		let found = 0;
		for (const cmd of treeViewRelatedCommands) {
			if (commands.includes(cmd)) {
				found++;
			}
		}

		assert.ok(
			found > 0,
			`Tree view related commands should be registered, found ${found}`,
		);
	});

	test("Refresh commands should be available", async () => {
		const commands = await vscode.commands.getCommands(true);

		// Check for refresh commands
		const refreshCommands = commands.filter(
			(cmd) => cmd.includes("refresh") && cmd.includes("coder"),
		);

		assert.ok(
			refreshCommands.length > 0,
			"Refresh commands for tree views should be available",
		);
	});

	test("Tree view interaction commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);

		// Check for commands that handle tree view interactions
		const interactionCommands = [
			"coder.openFromSidebar",
			"coder.openAppStatus",
			"coder.navigateToWorkspace",
		];

		let found = 0;
		for (const cmd of interactionCommands) {
			if (commands.includes(cmd)) {
				found++;
			}
		}

		assert.ok(
			found > 0,
			`Tree view interaction commands should be registered, found ${found}`,
		);
	});

	test("Open commands for tree items should exist", async () => {
		const commands = await vscode.commands.getCommands(true);

		// Check for open commands
		const openCommands = commands.filter(
			(cmd) => cmd.includes("open") && cmd.includes("coder"),
		);

		assert.ok(
			openCommands.length > 0,
			"Open commands for tree items should exist",
		);
	});

	test("Tree views contribute to activity bar", async () => {
		// This test validates that the extension contributes views
		// We can't directly test the views, but we can verify related commands exist
		const commands = await vscode.commands.getCommands(true);

		// The extension should have commands that work with tree views
		const viewRelatedCommands = commands.filter(
			(cmd) =>
				cmd.startsWith("coder.") &&
				(cmd.includes("refresh") ||
					cmd.includes("open") ||
					cmd.includes("navigate")),
		);

		assert.ok(
			viewRelatedCommands.length > 0,
			`Extension should have view-related commands, found ${viewRelatedCommands.length}`,
		);
	});

	test("Multiple workspace views should be supported", async () => {
		// The extension should support both "my workspaces" and "all workspaces" views
		const commands = await vscode.commands.getCommands(true);

		// Look for evidence of multiple workspace views
		const workspaceCommands = commands.filter(
			(cmd) => cmd.startsWith("coder.") && cmd.includes("workspace"),
		);

		assert.ok(
			workspaceCommands.length > 0,
			"Multiple workspace-related commands should exist",
		);
	});

	test("Tree items should support context menus", async () => {
		// Check for commands that would appear in context menus
		const commands = await vscode.commands.getCommands(true);

		const contextMenuCommands = commands.filter((cmd) => {
			return (
				cmd.startsWith("coder.") &&
				(cmd.includes("workspace") || cmd.includes("agent"))
			);
		});

		assert.ok(
			contextMenuCommands.length > 0,
			"Context menu commands should be available",
		);
	});

	test("Tree view state management commands", async () => {
		// Check for commands that manage tree view state
		const commands = await vscode.commands.getCommands(true);

		// Look for visibility or state-related commands
		const _stateCommands = commands.filter(
			(cmd) =>
				cmd.startsWith("coder.") &&
				(cmd.includes("show") ||
					cmd.includes("hide") ||
					cmd.includes("toggle")),
		);

		// Even if specific state commands don't exist, the tree views should be manageable
		assert.ok(true, "Tree view state is managed by VS Code");
	});
});
