import { StatusDot, statusTone } from "./StatusDot";

import type { Workspace } from "@repo/shared";

export function WorkspaceRow({ workspace }: { workspace: Workspace }) {
	const buildStatus = workspace.latest_build.status;
	const status =
		buildStatus === "running" && !workspace.health.healthy
			? "unhealthy"
			: buildStatus;
	return (
		<span className="workspace-label">
			<StatusDot status={status} tone={statusTone(status)} />
			<span className="workspace-name">{workspace.name || "Unknown"}</span>
			<span className="workspace-owner">
				{workspace.owner_name || "Unknown"}
			</span>
		</span>
	);
}
