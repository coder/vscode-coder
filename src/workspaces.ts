import * as vscode from 'vscode';
import * as cp from 'child_process';

export class CoderWorkspacesProvider implements vscode.TreeDataProvider<CoderWorkspace> {

	private _onDidChangeTreeData: vscode.EventEmitter<CoderWorkspace | undefined | void> = new vscode.EventEmitter<CoderWorkspace | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CoderWorkspace | undefined | void> = this._onDidChangeTreeData.event;

	constructor() {
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: CoderWorkspace): vscode.TreeItem {
		return element;
	}

	getChildren(element?: CoderWorkspace): Thenable<CoderWorkspace[]> {
		return getWorkspaces();
	}
}

export const rebuildWorkspace = async (name: string): Promise<void> => {
	return new Promise((res, rej) => {
		cp.exec(`coder envs rebuild ${name} --force`, (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage(`Failed to rebuild Coder Workspaces: ${err}`);
				rej(err);
				return;
			}
			res();
			vscode.window.showInformationMessage(`Rebuilding Coder Workspace "${name}"`);
		});
	});
};

export const openWorkspace = async (name: string): Promise<void> => {
	return new Promise((res, rej) => {
		cp.exec(`code --remote "ssh-remote+coder.${name}" /home/coder`, (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage(`Failed to open Coder Workspaces: ${err}`);
				rej(err);
				return;
			}
			res();
			vscode.window.showInformationMessage(`Opening Coder Workspace "${name}"`);
		});
	});
}

const getWorkspaces = async (): Promise<CoderWorkspace[]> => {
	const images = await getImages();
		return new Promise((res, rej) => {
			cp.exec("coder envs ls --output json", (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage('Failed to fetch Coder Workspaces');
					res([]);
					return;
				}
				const workspaces: CoderWorkspace[] = JSON.parse(stdout);
				res(workspaces.map(w => new CoderWorkspace(w, images, vscode.TreeItemCollapsibleState.None)));
			});
		});
};

const getImages = (): Promise<CoderImage[]> => {
		return new Promise((res, rej) => {
			cp.exec("coder images ls --output json", (err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage('Failed to fetch Coder Images');
					res([]);
					return;
				}
				res(JSON.parse(stdout));
			});
		});
};


export interface CoderWorkspace {
	id: string
	name: string
	cpu_cores: number
	memory_gb: number
	updated: boolean
	image_tag: string
	image_id: string
	gpus: number
}

export interface CoderImage {
	id: string
	repository: string
}

export class CoderWorkspace extends vscode.TreeItem {
	constructor(
		public readonly workspace: CoderWorkspace,
		public readonly images: CoderImage[],
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(workspace.name, collapsibleState);

		this.tooltip = `${this.label}`;
		const image = images.find(a => a.id === workspace.image_id);
		this.description = `${image.repository}:${workspace.image_tag}, ${workspace.cpu_cores} vCPU, ${workspace.memory_gb}GB Memory`;
	}
}
