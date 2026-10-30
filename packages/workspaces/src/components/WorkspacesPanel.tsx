import {
	Banner,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	EmptyState,
	ErrorState,
	Icon,
	LoadingState,
	MenuRadioGroup,
	MenuRadioItem,
	ProgressBar,
	Tooltip,
	TooltipProvider,
	Tree,
	type TreeNode,
} from "@repo/ui";
import { format, formatISO } from "date-fns";
import { useEffect, useEffectEvent, useState } from "react";

import {
	AgentHover,
	AgentRow,
	appStatusNodes,
	metadataNodes,
} from "./AgentRow";
import { WorkspaceActions } from "./WorkspaceActions";
import { WorkspaceHover, WorkspaceRow } from "./WorkspaceRow";

import type { Workspace, WorkspaceAgent, WorkspacesState } from "@repo/shared";

import type { useWorkspaces } from "../hooks/useWorkspaces";

export type WorkspaceCommands = Pick<
	ReturnType<typeof useWorkspaces>["api"],
	| "login"
	| "openWorkspace"
	| "viewInDashboard"
	| "runWorkspaceAction"
	| "refresh"
	| "setFilter"
	| "watchAgents"
>;

const FILTERS = [
	{ value: "all", label: "All" },
	{ value: "mine", label: "Mine" },
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
	const showOwner = state?.filter !== "mine";
	const filterLabel = FILTERS.find(
		({ value }) => value === state?.filter,
	)?.label;
	const agentWorkspaces = new Set(state?.agentWorkspaceIds ?? []);
	const watched: string[] = [];

	const nodes: readonly TreeNode[] = workspaces.map((workspace) => {
		const agents = workspaceAgents(workspace);
		const agentNode = (agent: WorkspaceAgent, visible: boolean): TreeNode => {
			const metadataId = `metadata:${agent.id}`;
			const childrenVisible = visible && expandedIds.includes(agent.id);
			if (childrenVisible && expandedIds.includes(metadataId)) {
				watched.push(agent.id);
			}
			const name = agent.name || "Unknown";
			return {
				id: agent.id,
				textValue: name,
				tooltip: <AgentHover agent={agent} />,
				label: <AgentRow agent={agent} />,
				action: (
					<WorkspaceActions workspace={workspace} agent={agent} api={api} />
				),
				children: [
					...appStatusNodes(agent),
					...agents
						.filter((child) => child.parent_id === agent.id)
						.map((child) => agentNode(child, childrenVisible)),
					{
						id: metadataId,
						label: "Metadata",
						className: "workspace-metadata-heading",
						children: metadataNodes(agent.id, state?.metadata[agent.id]),
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
		const name = workspace.name || "Unknown";
		const hasAgentChat = agentWorkspaces.has(workspace.id);
		const pendingAction = state?.pendingActions?.[workspace.id];
		return {
			id: workspace.id,
			textValue: `${name}${hasAgentChat ? " Agent" : ""}${showOwner ? ` ${workspace.owner_name || "Unknown"}` : ""}`,
			tooltip: (
				<WorkspaceHover
					workspace={workspace}
					showOwner={showOwner}
					pendingAction={pendingAction}
				/>
			),
			label: (
				<WorkspaceRow
					workspace={workspace}
					showOwner={showOwner}
					hasAgentChat={hasAgentChat}
					pendingAction={pendingAction}
				/>
			),
			action: (
				<WorkspaceActions
					workspace={workspace}
					pendingAction={pendingAction}
					api={api}
				/>
			),
			children: children.length
				? children
				: [{ id: `agents:${workspace.id}`, label: "No workspace agents" }],
		};
	});

	const watchedKey = JSON.stringify(watched.sort());
	const syncWatch = useEffectEvent(() =>
		api.watchAgents({ agentIds: watched }),
	);
	useEffect(() => {
		syncWatch();
	}, [watchedKey]);

	if (state && !state.capabilities.authenticated) {
		return (
			<EmptyState
				title="Welcome to Coder"
				description="Coder is a platform that provisions remote development environments."
				action={<Button onClick={() => api.login()}>Login</Button>}
			/>
		);
	}

	const loading = !state || state.status.kind === "loading";
	return (
		<TooltipProvider>
			<section className="workspaces-panel" aria-label="Workspaces">
				{state && (
					<div className="workspaces-filter-bar">
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="secondary"
										className="workspace-filter"
										aria-label={`Workspace filter: ${filterLabel}`}
									>
										{filterLabel}
										<Icon name="chevron-down" />
									</Button>
								}
							/>
							<DropdownMenuContent align="start">
								<MenuRadioGroup
									value={state.filter}
									onValueChange={(filter) => {
										const choice = FILTERS.find(
											({ value }) => value === filter,
										);
										if (choice) api.setFilter({ filter: choice.value });
									}}
								>
									{FILTERS.map(({ value, label }) => (
										<MenuRadioItem
											key={value}
											value={value}
											disabled={!state.capabilities.filters.includes(value)}
										>
											{label}
										</MenuRadioItem>
									))}
								</MenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
						{state.listedAt !== undefined && state.status.kind !== "failed" && (
							<span className="workspaces-updated">
								<span
									className="workspaces-updated__separator"
									aria-hidden="true"
								/>
								<Tooltip content={formatISO(state.listedAt)}>
									<span className="workspaces-updated__text" tabIndex={0}>
										Updated {format(state.listedAt, "p")}
									</span>
								</Tooltip>
							</span>
						)}
					</div>
				)}
				{state?.status.kind === "failed" &&
					(nodes.length > 0 ? (
						<Banner
							severity="warning"
							className="workspaces-stale"
							actionLabel="Retry"
							onAction={() => api.refresh()}
						>
							Couldn't refresh.
							{state.listedAt !== undefined &&
								` Showing results from ${format(state.listedAt, "p")}.`}
							<div className="workspaces-stale__error">
								{state.status.error}
							</div>
						</Banner>
					) : (
						<ErrorState
							title="Could not load workspaces"
							description={state.status.error}
							onRetry={() => api.refresh()}
						/>
					))}
				{nodes.length > 0 ? (
					<>
						{loading && (
							<ProgressBar
								className="workspaces-refresh-progress"
								label="Refreshing workspaces"
							/>
						)}
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
					state.status.kind !== "failed" && (
						<EmptyState
							title="No workspaces"
							description="No workspaces match this filter."
						/>
					)
				)}
			</section>
		</TooltipProvider>
	);
}
