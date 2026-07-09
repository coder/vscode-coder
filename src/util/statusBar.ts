import * as vscode from "vscode";

interface StatusBarItemSpec {
	/** Omitted for pre-registry items; a new id orphans hide preferences. */
	readonly id?: string;
	readonly name: string;
	readonly priority: number;
}

/** All Coder status bar items; higher priority renders further left. */
const STATUS_BAR_ITEMS = {
	networkStatus: { name: "Coder Network Status", priority: 1000 },
	workspaceUpdate: { name: "Coder Workspace Update", priority: 999 },
	announcements: {
		id: "announcements",
		name: "Coder Announcements",
		priority: 998,
	},
	// Priority 0 preserves its pre-registry placement.
	agentMetadata: {
		id: "agentMetadata",
		name: "Coder Agent Metadata",
		priority: 0,
	},
} satisfies Record<string, StatusBarItemSpec>;

/** Creates a registered status bar item with its id, name, and priority. */
export function createStatusBarItem(
	key: keyof typeof STATUS_BAR_ITEMS,
): vscode.StatusBarItem {
	const { id, name, priority }: StatusBarItemSpec = STATUS_BAR_ITEMS[key];
	const item = id
		? vscode.window.createStatusBarItem(
				id,
				vscode.StatusBarAlignment.Left,
				priority,
			)
		: vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Left,
				priority,
			);
	item.name = name;
	return item;
}
