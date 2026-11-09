import { Spinner, StatusPill } from "@repo/ui";

import { RowHover } from "./RowHover";
import { formatStatus, StatusDot } from "./StatusDot";

import type { Workspace, WorkspaceAction } from "@repo/shared";

const PENDING_LABELS: Readonly<Record<WorkspaceAction, string>> = {
	start: "Starting",
	stop: "Stopping",
	restart: "Restarting",
	update: "Updating",
	delete: "Deleting",
};

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
	pendingAction,
}: {
	workspace: Workspace;
	showOwner: boolean;
	pendingAction?: WorkspaceAction;
}) {
	const template =
		workspace.template_display_name || workspace.template_name || "Unknown";
	const status = pendingAction
		? PENDING_LABELS[pendingAction]
		: formatStatus(workspaceStatus(workspace));
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
	pendingAction,
}: {
	workspace: Workspace;
	showOwner: boolean;
	hasAgentChat: boolean;
	pendingAction?: WorkspaceAction;
}) {
	return (
		<span className="workspace-label">
			{pendingAction ? (
				<Spinner size="small" label={PENDING_LABELS[pendingAction]} />
			) : (
				<StatusDot status={workspaceStatus(workspace)} />
			)}
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
