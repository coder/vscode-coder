import { Icon, Spinner, type TreeNode } from "@repo/ui";
import { formatDistanceToNowStrict } from "date-fns";

import { RowHover } from "./RowHover";
import { formatStatus, StatusDot } from "./StatusDot";

import type { AgentMetadataState, WorkspaceAgent } from "@repo/shared";

function agentStatus(agent: WorkspaceAgent): string {
	if (agent.status !== "connected") {
		return agent.status;
	}
	if (agent.lifecycle_state !== "ready") {
		return agent.lifecycle_state;
	}
	return agent.health.healthy ? "connected" : "unhealthy";
}

export function AgentHover({ agent }: { agent: WorkspaceAgent }) {
	return (
		<RowHover
			title={agent.name || "Unknown"}
			details={[
				["Status", formatStatus(agentStatus(agent))],
				["Type", agent.parent_id ? "Dev container agent" : "Workspace agent"],
			]}
		/>
	);
}

export function AgentRow({ agent }: { agent: WorkspaceAgent }) {
	return (
		<span className="workspace-label">
			<StatusDot status={agentStatus(agent)} />
			<span className="workspace-name">{agent.name || "Unknown"}</span>
			<Icon
				name={agent.parent_id ? "package" : "server"}
				className="workspace-agent-icon"
			/>
		</span>
	);
}

export function appStatusNodes(agent: WorkspaceAgent): readonly TreeNode[] {
	return agent.apps.flatMap((app) => {
		if (app.statuses.length === 0) {
			return [];
		}
		const status = app.statuses.reduce((latest, candidate) =>
			Date.parse(candidate.created_at) > Date.parse(latest.created_at)
				? candidate
				: latest,
		);
		const text = `${app.display_name || app.slug}: ${status.message || formatStatus(status.state)}`;
		return [
			{
				id: `app-status:${app.id}`,
				textValue: text,
				label: (
					<span className="workspace-label">
						<StatusDot status={status.state} />
						<span className="workspace-name">{text}</span>
					</span>
				),
			},
		];
	});
}

export function metadataNodes(
	agentId: string,
	state: AgentMetadataState | undefined,
): readonly TreeNode[] {
	const prefix = `metadata:${agentId}`;
	if (!state || state.kind === "pending") {
		return [
			{
				id: `${prefix}:loading`,
				textValue: "Loading metadata",
				label: (
					<span className="workspace-label">
						<Spinner size="small" label="Loading metadata" />
						<span className="workspace-name">Loading metadata...</span>
					</span>
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
				<span
					className={`workspace-metadata${result.error ? " workspace-metadata--error" : ""}`}
				>
					<span>{name}:</span>
					<span>{value}</span>
				</span>
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
