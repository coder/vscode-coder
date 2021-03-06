'use strict';

import * as vscode from 'vscode';

import { CoderWorkspacesProvider, CoderWorkspace, rebuildWorkspace, openWorkspace } from './workspaces';

export function activate(context: vscode.ExtensionContext) {
	const workspaceProvider = new CoderWorkspacesProvider();
	vscode.window.registerTreeDataProvider('coderWorkspaces', workspaceProvider);
	vscode.commands.registerCommand("coderWorkspaces.openWorkspace", (ws: CoderWorkspace) => {
		const { name } = ws.workspace;
		openWorkspace(name);
	});
	vscode.commands.registerCommand("coderWorkspaces.rebuildWorkspace", (ws: CoderWorkspace) => {
		const { name } = ws.workspace;
		rebuildWorkspace(name);
	});

	vscode.commands.registerCommand("coderWorkspaces.refreshWorkspaces", (a, b) => {
		workspaceProvider.refresh();
	});
}