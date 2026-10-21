import { Icon } from "@repo/ui";

import { RowLabel } from "./RowLabel";
import { agentStatus } from "./status";
import { StatusDot } from "./StatusDot";

import type { WorkspaceAgent } from "@repo/shared";

export function AgentRow({ agent }: { agent: WorkspaceAgent }) {
	return (
		<RowLabel
			icon={<StatusDot status={agentStatus(agent)} />}
			name={agent.name || "Unknown"}
		>
			<Icon
				name={agent.parent_id ? "package" : "server"}
				className="workspace-label__muted"
			/>
		</RowLabel>
	);
}
