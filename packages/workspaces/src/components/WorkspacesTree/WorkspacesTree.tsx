import { Tree } from "@repo/ui";
import { useEffect, useState } from "react";

import { watchedAgentIds, workspaceAgents, workspaceNodes } from "./treeNodes";
import "./WorkspacesTree.css";

import type { AgentMetadataMap, Workspace } from "@repo/shared";

import type { WorkspacesApiClient } from "../../hooks/useWorkspaces";

export function WorkspacesTree({
	workspaces,
	metadata,
	chatWorkspaceIds,
	showOwner,
	api,
}: {
	workspaces: readonly Workspace[];
	metadata: AgentMetadataMap;
	chatWorkspaceIds: readonly string[];
	showOwner: boolean;
	api: WorkspacesApiClient;
}) {
	const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
	const [selectedItemId, setSelectedItemId] = useState<string>();
	const nodes = workspaceNodes({
		workspaces,
		metadata,
		chatWorkspaceIds,
		showOwner,
		api,
	});

	useEffect(() => () => api.watchAgents({ agentIds: [] }), [api]);

	function expand(ids: readonly string[]) {
		// Opening a workspace opens its agents too.
		const openedAgentIds = workspaces
			.filter(({ id }) => ids.includes(id) && !expandedIds.includes(id))
			.flatMap(workspaceAgents)
			.map(({ id }) => id)
			.filter((id) => !ids.includes(id));
		const next = [...ids, ...openedAgentIds];
		setExpandedIds(next);
		api.watchAgents({ agentIds: watchedAgentIds(nodes, next) });
	}

	if (nodes.length === 0) {
		return null;
	}
	return (
		<Tree
			aria-label="Workspaces"
			nodes={nodes}
			expandedIds={expandedIds}
			onExpandedIdsChange={expand}
			selectedItemId={selectedItemId}
			onSelectedItemChange={setSelectedItemId}
		/>
	);
}
