import { StatusPill } from "@repo/ui";

import { StatusDot, statusTone } from "./StatusDot";

import type { Workspace } from "@repo/shared";

export function workspaceTooltip(workspace: Workspace): string {
	const status = workspace.latest_build.status;
	return `Template: ${workspace.template_display_name || workspace.template_name || "Unknown"} • Status: ${status.charAt(0).toUpperCase() + status.slice(1)}`;
}

export function WorkspaceRow({
	workspace,
	showOwner = true,
	hasAgentChat = false,
}: {
	workspace: Workspace;
	showOwner?: boolean;
	hasAgentChat?: boolean;
}) {
	const buildStatus = workspace.latest_build.status;
	const status =
		buildStatus === "running" && !workspace.health.healthy
			? "unhealthy"
			: buildStatus;
	return (
		<span className="workspace-label">
			<StatusDot status={status} tone={statusTone(status)} />
			<span className="workspace-name">{workspace.name || "Unknown"}</span>
			{hasAgentChat && (
				<StatusPill tone="info" className="workspace-agent-badge">
					Agent
				</StatusPill>
			)}
			{showOwner && (
				<span className="workspace-owner">
					{workspace.owner_name || "Unknown"}
				</span>
			)}
		</span>
	);
}
