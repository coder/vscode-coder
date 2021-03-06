'use strict';

import * as vscode from 'vscode';
import { CoderHelpProvider } from './help';

import { CoderWorkspacesProvider, CoderWorkspace, rebuildWorkspace, openWorkspace, shutdownWorkspace } from './workspaces';

export function activate(context: vscode.ExtensionContext) {
	const workspaceProvider = new CoderWorkspacesProvider();
	vscode.window.registerTreeDataProvider('coderWorkspaces', workspaceProvider);
	vscode.window.registerTreeDataProvider('coderHelpFeedback', new CoderHelpProvider());
	vscode.commands.registerCommand("coderWorkspaces.openWorkspace", (ws: CoderWorkspace) => {
		const { name } = ws.workspace;
		openWorkspace(name);
	});
	vscode.commands.registerCommand("coderWorkspaces.rebuildWorkspace", (ws: CoderWorkspace) => {
		const { name } = ws.workspace;
		rebuildWorkspace(name).then(() => workspaceProvider.refresh());
	});
	vscode.commands.registerCommand("coderWorkspaces.shutdownWorkspace", (ws: CoderWorkspace) => {
		const { name } = ws.workspace;
		shutdownWorkspace(name).then(() => workspaceProvider.refresh());
	});

	vscode.commands.registerCommand("coderWorkspaces.refreshWorkspaces", () => {
		workspaceProvider.refresh();
	});
}