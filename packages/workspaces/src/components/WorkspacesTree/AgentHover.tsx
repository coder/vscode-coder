import { RowHover } from "./RowHover";
import { agentStatus, formatStatus } from "./status";

import type { WorkspaceAgent } from "@repo/shared";

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
