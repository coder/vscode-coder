import { StatusPill } from "@repo/ui";

import { RowLabel } from "./RowLabel";
import { workspaceStatus } from "./status";
import { StatusDot } from "./StatusDot";

import type { Workspace } from "@repo/shared";

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
		<RowLabel
			icon={<StatusDot status={workspaceStatus(workspace)} />}
			name={workspace.name || "Unknown"}
		>
			{hasAgentChat && (
				<StatusPill tone="info" className="workspace-agent-badge">
					Agent
				</StatusPill>
			)}
			{showOwner && (
				<span className="workspace-label__text workspace-label__muted">
					{workspace.owner_name || "Unknown"}
				</span>
			)}
		</RowLabel>
	);
}
