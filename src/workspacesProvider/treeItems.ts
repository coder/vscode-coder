import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import * as path from "path";
import * as vscode from "vscode";
import { errToStr, extractAgents, AgentMetadataEvent } from "../api-helper";

/**
 * A tree item that represents a collapsible section with child items
 */
export class SectionTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		public readonly children: vscode.TreeItem[],
	) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = "coderSectionHeader";
	}
}

export class ErrorTreeItem extends vscode.TreeItem {
	constructor(error: unknown) {
		super(
			"Failed to query metadata: " + errToStr(error, "no error provided"),
			vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = "coderAgentMetadata";
	}
}

export class AgentMetadataTreeItem extends vscode.TreeItem {
	constructor(metadataEvent: AgentMetadataEvent) {
		const label =
			metadataEvent.description.display_name.trim() +
			": " +
			metadataEvent.result.value.replace(/\n/g, "").trim();

		super(label, vscode.TreeItemCollapsibleState.None);
		const collected_at = new Date(
			metadataEvent.result.collected_at,
		).toLocaleString();

		this.tooltip = "Collected at " + collected_at;
		this.contextValue = "coderAgentMetadata";
	}
}

export class AppStatusTreeItem extends vscode.TreeItem {
	constructor(
		public readonly app: {
			name: string;
			url?: string;
			command?: string;
			workspace_name?: string;
		},
	) {
		super("", vscode.TreeItemCollapsibleState.None);
		this.description = app.name;
		this.contextValue = "coderAppStatus";

		// Add command to handle clicking on the app
		this.command = {
			command: "coder.openAppStatus",
			title: "Open App Status",
			arguments: [app],
		};
	}
}

type CoderOpenableTreeItemType =
	| "coderWorkspaceSingleAgent"
	| "coderWorkspaceMultipleAgents"
	| "coderAgent";

export class OpenableTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		tooltip: string,
		description: string,
		collapsibleState: vscode.TreeItemCollapsibleState,

		public readonly workspaceOwner: string,
		public readonly workspaceName: string,
		public readonly workspaceAgent: string | undefined,
		public readonly workspaceFolderPath: string | undefined,

		contextValue: CoderOpenableTreeItemType,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.tooltip = tooltip;
		this.description = description;
	}

	iconPath = {
		light: path.join(__filename, "..", "..", "..", "media", "logo.svg"),
		dark: path.join(__filename, "..", "..", "..", "media", "logo.svg"),
	};
}

export class AgentTreeItem extends OpenableTreeItem {
	constructor(
		public readonly agent: WorkspaceAgent,
		workspaceOwner: string,
		workspaceName: string,
		watchMetadata = false,
	) {
		super(
			agent.name, // label
			`Status: ${agent.status}`, // tooltip
			agent.status, // description
			watchMetadata
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
			workspaceOwner,
			workspaceName,
			agent.name,
			agent.expanded_directory,
			"coderAgent",
		);
	}
}

export class WorkspaceTreeItem extends OpenableTreeItem {
	public appStatus: {
		name: string;
		url?: string;
		agent_id?: string;
		agent_name?: string;
		command?: string;
		workspace_name?: string;
	}[] = [];

	constructor(
		public readonly workspace: Workspace,
		public readonly showOwner: boolean,
		public readonly watchMetadata = false,
	) {
		const status =
			workspace.latest_build.status.substring(0, 1).toUpperCase() +
			workspace.latest_build.status.substring(1);

		const label = showOwner
			? `${workspace.owner_name} / ${workspace.name}`
			: workspace.name;
		const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`;
		const agents = extractAgents(workspace);
		super(
			label,
			detail,
			workspace.latest_build.status, // description
			showOwner
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.Expanded,
			workspace.owner_name,
			workspace.name,
			undefined,
			agents[0]?.expanded_directory,
			agents.length > 1
				? "coderWorkspaceMultipleAgents"
				: "coderWorkspaceSingleAgent",
		);
	}
}
