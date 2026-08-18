import {
	IconButton,
	StatusPill,
	Tooltip,
	type TreeNode,
	type StatusPillTone,
	type CodiconName,
} from "@repo/ui";
import { formatDistanceToNow } from "date-fns";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
	WorkspaceAppStatus,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { MockWorkspaceEntry } from "./mockData";

const WORKSPACE_STATUS_PILLS: Record<
	WorkspaceStatus,
	{ icon: CodiconName; tone: StatusPillTone }
> = {
	running: { icon: "play", tone: "success" },
	starting: { icon: "loading", tone: "info" },
	stopped: { icon: "pass", tone: "neutral" },
	failed: { icon: "error", tone: "danger" },
	pending: { icon: "history", tone: "info" },
	canceling: { icon: "loading", tone: "warning" },
	canceled: { icon: "debug-stop", tone: "neutral" },
	deleting: { icon: "loading", tone: "warning" },
	deleted: { icon: "archive", tone: "neutral" },
	stopping: { icon: "loading", tone: "warning" },
};

const AGENT_STATUS_PILLS: Record<
	WorkspaceAgent["status"],
	{ icon: CodiconName; tone: StatusPillTone }
> = {
	connected: { icon: "pass", tone: "success" },
	connecting: { icon: "loading", tone: "info" },
	disconnected: { icon: "alert", tone: "warning" },
	timeout: { icon: "alert", tone: "danger" },
};

const APP_STATUS_PILLS: Record<
	WorkspaceAppStatus["state"],
	{ icon: CodiconName; tone: StatusPillTone }
> = {
	complete: { icon: "pass", tone: "success" },
	failure: { icon: "error", tone: "danger" },
	idle: { icon: "circle-filled", tone: "neutral" },
	working: { icon: "loading", tone: "info" },
};

function statusPill(
	pill: { icon: CodiconName; tone: StatusPillTone },
	label: string,
): React.JSX.Element {
	return (
		<StatusPill icon={pill.icon} tone={pill.tone}>
			{label}
		</StatusPill>
	);
}

/** Marks the first case-insensitive match of the search query, like the native views. */
function highlight(text: string, query: string): React.ReactNode {
	const lowered = query.trim().toLocaleLowerCase();
	if (lowered === "") return text;
	const index = text.toLocaleLowerCase().indexOf(lowered);
	if (index === -1) return text;
	return (
		<>
			{text.slice(0, index)}
			<span className="workspaces-panel__highlight">
				{text.slice(index, index + lowered.length)}
			</span>
			{text.slice(index + lowered.length)}
		</>
	);
}

/** The workspace branch row: name, owner, status pill, and hover actions. */
export function workspaceNode(
	entry: MockWorkspaceEntry,
	showOwner: boolean,
	query: string,
): TreeNode {
	const { workspace } = entry;
	const status = workspace.latest_build.status;
	const textValue = showOwner
		? `${workspace.name} (${workspace.owner_name})`
		: workspace.name;
	return {
		id: workspace.id,
		label: (
			<span className="workspaces-panel__row-label">
				<span className="workspaces-panel__name">
					{highlight(workspace.name, query)}
				</span>
				{showOwner ? (
					<span className="workspaces-panel__owner">
						{highlight(workspace.owner_name, query)}
					</span>
				) : null}
				{statusPill(WORKSPACE_STATUS_PILLS[status], status)}
			</span>
		),
		textValue,
		icon: "window",
		action: (
			<>
				<IconButton icon="play" label={`Open ${workspace.name}`} />
				<IconButton
					icon="link-external"
					label={`Open ${workspace.name} in dashboard`}
				/>
				<IconButton
					icon="settings-gear"
					label={`Edit ${workspace.name} settings`}
				/>
			</>
		),
		children: entry.agents.map((agent) => agentNode(entry, agent, query)),
	};
}

/** The agent row: name, connection pill, hover actions, and inline sections. */
export function agentNode(
	entry: MockWorkspaceEntry,
	agent: WorkspaceAgent,
	query: string,
): TreeNode {
	const running = entry.workspace.latest_build.status === "running";
	const pill = running
		? statusPill(AGENT_STATUS_PILLS[agent.status], agent.status)
		: statusPill({ icon: "pass", tone: "neutral" }, "offline");
	const sections = [
		appStatusSection(entry.workspace, agent),
		metadataSection(agent.id, entry.metadata.get(agent.id)),
	].filter((section): section is TreeNode => section !== undefined);
	return {
		id: agent.id,
		label: (
			<span className="workspaces-panel__row-label">
				<span className="workspaces-panel__name">
					{highlight(agent.name, query)}
				</span>
				{pill}
			</span>
		),
		textValue: agent.name,
		icon: "server",
		action: (
			<>
				<IconButton icon="terminal" label={`Open terminal on ${agent.name}`} />
				<IconButton icon="list-unordered" label={`View ${agent.name} logs`} />
			</>
		),
		children: sections.length > 0 ? sections : undefined,
	};
}

/** App statuses inline under their agent; nothing when no app reports any. */
export function appStatusSection(
	workspace: Workspace,
	agent: WorkspaceAgent,
): TreeNode | undefined {
	const statuses = agent.apps.flatMap((app) =>
		app.statuses.map((status) => ({ app, status })),
	);
	if (statuses.length === 0) return undefined;
	return {
		id: `${agent.id}/app-statuses`,
		label: "App Statuses",
		children: statuses.map(({ app, status }) => ({
			id: status.id,
			label: (
				<span className="workspaces-panel__row-label">
					{statusPill(APP_STATUS_PILLS[status.state], status.state)}
					<span className="workspaces-panel__name">
						{app.display_name ?? app.slug}
					</span>
					<span className="workspaces-panel__owner">{status.message}</span>
				</span>
			),
			textValue: `${app.display_name ?? app.slug}: ${status.message}`,
		})),
	};
}

/** Agent metadata inline under their agent; values carry a collected-at tooltip. */
export function metadataSection(
	agentId: string,
	metadata: readonly WorkspaceAgentMetadata[] | undefined,
): TreeNode | undefined {
	if (!metadata || metadata.length === 0) return undefined;
	return {
		id: `${agentId}/metadata`,
		label: "Agent Metadata",
		children: metadata.map((entry) => ({
			id: `${agentId}/metadata/${entry.description.key}`,
			label: (
				<span className="workspaces-panel__row-label">
					<span className="workspaces-panel__owner">
						{entry.description.display_name}
					</span>
					<Tooltip
						content={
							<span>
								Collected{" "}
								{formatDistanceToNow(new Date(entry.result.collected_at), {
									addSuffix: true,
								})}
							</span>
						}
					>
						<span className="workspaces-panel__name">{entry.result.value}</span>
					</Tooltip>
				</span>
			),
			textValue: `${entry.description.display_name}: ${entry.result.value}`,
		})),
	};
}
