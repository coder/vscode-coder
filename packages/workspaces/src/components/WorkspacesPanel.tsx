import {
	EmptyState,
	ErrorState,
	LoadingState,
	ProgressBar,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	TooltipProvider,
	Tree,
	type TreeNode,
} from "@repo/ui";
import { useEffect, useEffectEvent, useState } from "react";

import { agentMetadataNodes } from "./AgentMetadataList";
import { AgentRow } from "./AgentRow";
import { appStatusNodes } from "./AppStatusRow";
import { WorkspaceActions, type WorkspaceCommands } from "./WorkspaceActions";
import { WorkspaceRow } from "./WorkspaceRow";

import type { Workspace, WorkspaceAgent, WorkspacesState } from "@repo/shared";

const FILTERS = [
	{ value: "all", label: "All" },
	{ value: "mine", label: "My" },
	{ value: "shared", label: "Shared" },
] as const;

function workspaceAgents(workspace: Workspace) {
	return workspace.latest_build.resources.flatMap(
		(resource) => resource.agents ?? [],
	);
}

export function WorkspacesPanel({
	state,
	api,
}: {
	state?: WorkspacesState;
	api: WorkspaceCommands;
}) {
	const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
	const [selectedItemId, setSelectedItemId] = useState<string>();
	const workspaces = state?.capabilities.authenticated ? state.workspaces : [];
	const watched: string[] = [];

	const nodes: TreeNode[] = workspaces.map((workspace) => {
		const agents = workspaceAgents(workspace);
		const agentNode = (agent: WorkspaceAgent, visible: boolean): TreeNode => {
			const metadataId = `metadata:${agent.id}`;
			if (
				visible &&
				expandedIds.includes(agent.id) &&
				expandedIds.includes(metadataId)
			) {
				watched.push(agent.id);
			}
			return {
				id: agent.id,
				textValue: agent.name || "Unknown",
				label: <AgentRow agent={agent} />,
				action: (
					<WorkspaceActions
						workspaceId={workspace.id}
						name={agent.name || "Unknown"}
						agentId={agent.id}
						api={api}
					/>
				),
				children: [
					...appStatusNodes(agent),
					...agents
						.filter((child) => child.parent_id === agent.id)
						.map((child) =>
							agentNode(child, visible && expandedIds.includes(agent.id)),
						),
					{
						id: metadataId,
						label: "Agent metadata",
						className: "workspace-metadata-heading",
						children: agentMetadataNodes(agent.id, state?.metadata[agent.id]),
					},
				],
			};
		};
		const children = agents
			.filter(
				(agent) =>
					!agent.parent_id ||
					!agents.some((parent) => parent.id === agent.parent_id),
			)
			.map((agent) => agentNode(agent, expandedIds.includes(workspace.id)));
		return {
			id: workspace.id,
			textValue: `${workspace.name || "Unknown"} ${workspace.owner_name || "Unknown"}`,
			label: <WorkspaceRow workspace={workspace} />,
			action: (
				<WorkspaceActions
					workspaceId={workspace.id}
					name={workspace.name || "Unknown"}
					api={api}
				/>
			),
			children: children.length
				? children
				: [{ id: `agents:${workspace.id}`, label: "No agents available" }],
		};
	});

	const watchedKey = JSON.stringify(watched.sort());
	const syncWatch = useEffectEvent(() =>
		api.watchAgents({ agentIds: watched }),
	);
	const clearWatch = useEffectEvent(() => api.watchAgents({ agentIds: [] }));
	useEffect(() => {
		syncWatch();
	}, [watchedKey]);
	useEffect(() => () => clearWatch(), []);

	const loading = !state || state.status.kind === "loading";
	return (
		<TooltipProvider>
			<section className="workspaces-panel" aria-label="Workspaces">
				<div className="workspaces-filter-bar">
					{state?.capabilities.authenticated && (
						<Select
							items={FILTERS}
							value={state.filter}
							onValueChange={(filter) => {
								if (filter && state.capabilities.filters.includes(filter))
									api.setFilter({ filter });
							}}
						>
							<SelectTrigger
								className="workspace-filter"
								aria-label="Workspace filter"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{FILTERS.map(({ value, label }) => (
									<SelectItem
										key={value}
										value={value}
										disabled={!state.capabilities.filters.includes(value)}
									>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
				{state && !state.capabilities.authenticated ? (
					<EmptyState
						title="Welcome to Coder"
						description="Run Coder: Login from the Command Palette to view your workspaces."
					/>
				) : (
					<>
						{state?.status.kind === "failed" && (
							<ErrorState
								title="Could not load workspaces"
								description={state.status.error}
								onRetry={() => api.refresh()}
							/>
						)}
						{nodes.length > 0 ? (
							<>
								{loading && <ProgressBar label="Refreshing workspaces" />}
								<Tree
									aria-label="Workspaces"
									nodes={nodes}
									expandedIds={expandedIds}
									onExpandedIdsChange={(ids) => {
										const opened = workspaces.filter(
											(workspace) =>
												ids.includes(workspace.id) &&
												!expandedIds.includes(workspace.id),
										);
										setExpandedIds([
											...ids,
											...opened
												.flatMap(workspaceAgents)
												.map((agent) => agent.id)
												.filter((id) => !ids.includes(id)),
										]);
									}}
									selectedItemId={selectedItemId}
									onSelectedItemChange={setSelectedItemId}
								/>
							</>
						) : loading ? (
							<LoadingState label="Loading workspaces" />
						) : (
							state?.status.kind !== "failed" && (
								<EmptyState
									title="No workspaces"
									description="No workspaces match this filter."
								/>
							)
						)}
					</>
				)}
			</section>
		</TooltipProvider>
	);
}
