import { StatusPill } from "@repo/ui";

import { RowHover } from "./RowHover";
import { formatStatus, StatusDot } from "./StatusDot";

import type { Workspace } from "@repo/shared";

/** Health is only meaningful for the build that is running. */
function workspaceStatus(workspace: Workspace): string {
	const status = workspace.latest_build.status;
	return status === "running" && !workspace.health.healthy
		? "unhealthy"
		: status;
}

export function WorkspaceHover({
	workspace,
	showOwner,
}: {
	workspace: Workspace;
	showOwner: boolean;
}) {
	const template =
		workspace.template_display_name || workspace.template_name || "Unknown";
	const status = formatStatus(workspaceStatus(workspace));
	return (
		<RowHover
			title={workspace.name || "Unknown"}
			details={[
				["Status", status],
				...(showOwner
					? [["Owner", workspace.owner_name || "Unknown"] as const]
					: []),
				["Template", template],
			]}
		/>
	);
}

export function WorkspaceRow({
	workspace,
	showOwner,
	hasAgentChat,
}: {
	workspace: Workspace;
	showOwner: boolean;
	hasAgentChat: boolean;
}) {
	return (
		<span className="workspace-label">
			<StatusDot status={workspaceStatus(workspace)} />
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
