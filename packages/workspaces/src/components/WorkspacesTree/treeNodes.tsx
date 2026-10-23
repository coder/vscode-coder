import { Spinner, type TreeNode } from "@repo/ui";
import { formatDistanceToNowStrict } from "date-fns";

import { AgentHover } from "./AgentHover";
import { AgentRow } from "./AgentRow";
import { MetadataRow } from "./MetadataRow";
import { OpenActions } from "./OpenActions";
import { RowLabel } from "./RowLabel";
import { formatStatus, latestAppStatus } from "./status";
import { StatusDot } from "./StatusDot";
import { WorkspaceActions } from "./WorkspaceActions";
import { WorkspaceHover } from "./WorkspaceHover";
import { WorkspaceRow } from "./WorkspaceRow";

import type {
	AgentMetadataMap,
	AgentMetadataState,
	Workspace,
	WorkspaceAgent,
} from "@repo/shared";

import type { WorkspacesApiClient } from "../../hooks/useWorkspaces";

const METADATA_PREFIX = "metadata:";

export interface WorkspaceNodesInput {
	readonly workspaces: readonly Workspace[];
	readonly metadata: AgentMetadataMap;
	readonly chatWorkspaceIds: readonly string[];
	readonly showOwner: boolean;
	readonly api: WorkspacesApiClient;
}

export function workspaceNodes(input: WorkspaceNodesInput): TreeNode[] {
	return input.workspaces.map((workspace) => workspaceNode(workspace, input));
}

/** Agents whose metadata heading is expanded under expanded ancestors. */
export function watchedAgentIds(
	nodes: readonly TreeNode[],
	expandedIds: readonly string[],
): string[] {
	return nodes.flatMap((node) => {
		if (!node.children || !expandedIds.includes(node.id)) {
			return [];
		}
		const watched = watchedAgentIds(node.children, expandedIds);
		if (node.id.startsWith(METADATA_PREFIX)) {
			watched.push(node.id.slice(METADATA_PREFIX.length));
		}
		return watched;
	});
}

export function workspaceAgents(workspace: Workspace): WorkspaceAgent[] {
	return workspace.latest_build.resources.flatMap(
		(resource) => resource.agents ?? [],
	);
}

function workspaceNode(
	workspace: Workspace,
	{ metadata, chatWorkspaceIds, showOwner, api }: WorkspaceNodesInput,
): TreeNode {
	const name = workspace.name || "Unknown";
	const owner = workspace.owner_name || "Unknown";
	const hasAgentChat = chatWorkspaceIds.includes(workspace.id);
	const agents = workspaceAgents(workspace);
	// An agent whose parent is not listed shows at the top level.
	const children = agents
		.filter((agent) => !agents.some(({ id }) => id === agent.parent_id))
		.map((agent) => agentNode(agent, { workspace, agents, metadata, api }));
	return {
		id: workspace.id,
		textValue: [name, hasAgentChat && "Agent", showOwner && owner]
			.filter(Boolean)
			.join(" "),
		tooltip: <WorkspaceHover workspace={workspace} showOwner={showOwner} />,
		label: (
			<WorkspaceRow
				workspace={workspace}
				showOwner={showOwner}
				hasAgentChat={hasAgentChat}
			/>
		),
		action: <WorkspaceActions workspace={workspace} api={api} />,
		children: children.length
			? children
			: [{ id: `agents:${workspace.id}`, label: "No workspace agents" }],
	};
}

interface AgentContext {
	readonly workspace: Workspace;
	readonly agents: readonly WorkspaceAgent[];
	readonly metadata: AgentMetadataMap;
	readonly api: WorkspacesApiClient;
}

function agentNode(agent: WorkspaceAgent, ctx: AgentContext): TreeNode {
	const name = agent.name || "Unknown";
	const metadataId = `${METADATA_PREFIX}${agent.id}`;
	return {
		id: agent.id,
		textValue: name,
		tooltip: <AgentHover agent={agent} />,
		label: <AgentRow agent={agent} />,
		action: (
			<OpenActions
				name={name}
				target={{ workspaceId: ctx.workspace.id, agentId: agent.id }}
				api={ctx.api}
			/>
		),
		children: [
			...appStatusNodes(agent),
			...ctx.agents
				.filter((child) => child.parent_id === agent.id)
				.map((child) => agentNode(child, ctx)),
			{
				id: metadataId,
				label: "Metadata",
				className: "workspace-metadata-heading",
				children: metadataNodes(metadataId, ctx.metadata[agent.id]),
			},
		],
	};
}

function appStatusNodes(agent: WorkspaceAgent): TreeNode[] {
	return agent.apps.flatMap((app) => {
		const status = latestAppStatus(app.statuses);
		if (!status) {
			return [];
		}
		const text = `${app.display_name || app.slug}: ${status.message || formatStatus(status.state)}`;
		return {
			id: `app-status:${app.id}`,
			textValue: text,
			label: (
				<RowLabel icon={<StatusDot status={status.state} />} name={text} />
			),
		};
	});
}

function metadataNodes(
	prefix: string,
	state: AgentMetadataState | undefined,
): TreeNode[] {
	if (!state || state.kind === "pending") {
		return [
			{
				id: `${prefix}:loading`,
				textValue: "Loading metadata",
				label: (
					<RowLabel
						icon={<Spinner size="small" label="Loading metadata" />}
						name="Loading metadata..."
					/>
				),
			},
		];
	}
	if (state.kind === "failed") {
		return [{ id: `${prefix}:error`, label: state.error, icon: "error" }];
	}
	if (state.metadata.length === 0) {
		return [{ id: `${prefix}:empty`, label: "No metadata reported" }];
	}
	return state.metadata.map(({ description, result }) => {
		const name = description.display_name || description.key;
		const value = result.error || result.value || "Unknown";
		return {
			id: `${prefix}:${description.key}`,
			textValue: `${name}: ${value}`,
			label: (
				<MetadataRow name={name} value={value} failed={Boolean(result.error)} />
			),
			tooltip: (
				<>
					{name}: {value}
					<br />
					Collected{" "}
					{formatDistanceToNowStrict(new Date(result.collected_at), {
						addSuffix: true,
					})}
				</>
			),
		};
	});
}
