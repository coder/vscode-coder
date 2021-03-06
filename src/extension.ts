'use strict';

import * as vscode from 'vscode';

import { CoderWorkspacesProvider, CoderWorkspace } from './workspaces';

export function activate(context: vscode.ExtensionContext) {
	const workspaceProvider = new CoderWorkspacesProvider();
	vscode.window.registerTreeDataProvider('coderWorkspaces', workspaceProvider);

}