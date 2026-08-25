import {
	EmptyState,
	ErrorState,
	LoadingState,
	SearchInput,
	Tree,
	type TreeNode,
} from "@repo/ui";
import { useMemo, useState } from "react";

import { workspaceNode } from "./rows";
import {
	WorkspaceFilterSelect,
	type WorkspaceFilter,
} from "./WorkspaceFilterSelect";
import "./WorkspacesPanel.css";

import type { MockWorkspaceEntry } from "./mockData";

export interface WorkspacesPanelProps {
	readonly workspaces: readonly MockWorkspaceEntry[];
	/** Gates the "Shared" filter option, like `coder.isOwner`. */
	readonly isOwner?: boolean;
	readonly state?: "ready" | "loading" | "error";
	readonly onRetry?: () => void;
}

function filterEntries(
	entries: readonly MockWorkspaceEntry[],
	filter: WorkspaceFilter,
	query: string,
): readonly MockWorkspaceEntry[] {
	const lowered = query.trim().toLocaleLowerCase();
	return entries.filter((entry) => {
		if (filter === "mine" && entry.owner !== "me") return false;
		if (filter === "shared" && !entry.shared) return false;
		if (lowered === "") return true;
		const haystack = [
			entry.workspace.name,
			entry.workspace.owner_name,
			entry.workspace.template_display_name,
			...entry.agents.map((agent) => agent.name),
		]
			.join(" ")
			.toLocaleLowerCase();
		return haystack.includes(lowered);
	});
}

/** Expands workspaces and agents, leaving leaf sections collapsed. */
function initialExpandedIds(nodes: readonly TreeNode[]): readonly string[] {
	const ids: string[] = [];
	const visit = (node: TreeNode, depth: number): void => {
		if (node.children && depth < 2) {
			ids.push(node.id);
		}
		node.children?.forEach((child) => visit(child, depth + 1));
	};
	nodes.forEach((node) => visit(node, 0));
	return ids;
}

/** Prototype panel: toolbar, filtered tree, and the loading/error/empty states. */
export function WorkspacesPanel({
	workspaces,
	isOwner = false,
	state = "ready",
	onRetry,
}: WorkspacesPanelProps): React.JSX.Element {
	const [filter, setFilter] = useState<WorkspaceFilter>("mine");
	const [query, setQuery] = useState("");
	const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

	const nodes = useMemo(
		() =>
			filterEntries(workspaces, filter, query).map((entry) =>
				workspaceNode(entry, filter !== "mine", query),
			),
		[workspaces, filter, query],
	);
	const [expandedIds, setExpandedIds] = useState<readonly string[]>(() =>
		initialExpandedIds(nodes),
	);

	let body: React.JSX.Element;
	if (state === "loading") {
		body = <LoadingState title="Loading workspaces" />;
	} else if (state === "error") {
		body = (
			<ErrorState
				title="Failed to load workspaces"
				description="The Coder deployment could not be reached."
				onRetry={onRetry}
			/>
		);
	} else if (workspaces.length === 0) {
		body = (
			<EmptyState
				icon="inbox"
				title="No workspaces"
				description="Create a workspace to get started."
			/>
		);
	} else if (nodes.length === 0) {
		body = (
			<EmptyState
				icon="search"
				title="No matching workspaces"
				description={`No results for "${query}".`}
			/>
		);
	} else {
		body = (
			<div className="workspaces-panel__tree">
				<Tree
					aria-label="Workspaces"
					nodes={nodes}
					expandedIds={expandedIds}
					onExpandedIdsChange={setExpandedIds}
					selectedItemId={selectedItemId}
					onSelectedItemChange={setSelectedItemId}
					stickyScroll
				/>
			</div>
		);
	}

	return (
		<div className="workspaces-panel">
			<div className="workspaces-panel__toolbar">
				<SearchInput
					value={query}
					onChange={setQuery}
					label="Search workspaces"
					placeholder="Search workspaces"
				/>
				<WorkspaceFilterSelect
					isOwner={isOwner}
					value={filter}
					onChange={setFilter}
				/>
			</div>
			{body}
		</div>
	);
}
