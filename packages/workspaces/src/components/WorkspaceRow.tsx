import { StatusPill } from "@repo/ui";

import { StatusDot, statusTone } from "./StatusDot";

import type { Workspace } from "@repo/shared";

export function WorkspaceRow({
	workspace,
	hasAgentChat = false,
}: {
	workspace: Workspace;
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
			<span className="workspace-owner">
				{workspace.owner_name || "Unknown"}
			</span>
		</span>
	);
}
