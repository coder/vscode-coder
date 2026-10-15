import { Icon } from "@repo/ui";

import { StatusDot, statusTone } from "./StatusDot";

import type { WorkspaceAgent } from "@repo/shared";

export function AgentRow({ agent }: { agent: WorkspaceAgent }) {
	const status =
		agent.status === "connected"
			? agent.lifecycle_state === "ready"
				? agent.health.healthy
					? "connected"
					: "unhealthy"
				: agent.lifecycle_state
			: agent.status;
	return (
		<span className="workspace-label">
			<StatusDot status={status} tone={statusTone(status)} />
			<span className="workspace-name">{agent.name || "Unknown"}</span>
			<Icon
				name={agent.parent_id ? "package" : "server"}
				className="workspace-agent-icon"
			/>
		</span>
	);
}
