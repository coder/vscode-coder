import { RowHover } from "./RowHover";
import { formatStatus, workspaceStatus } from "./status";

import type { Workspace } from "@repo/shared";

export function WorkspaceHover({
	workspace,
	showOwner,
}: {
	workspace: Workspace;
	showOwner: boolean;
}) {
	const template =
		workspace.template_display_name || workspace.template_name || "Unknown";
	return (
		<RowHover
			title={workspace.name || "Unknown"}
			details={[
				["Status", formatStatus(workspaceStatus(workspace))],
				...(showOwner
					? [["Owner", workspace.owner_name || "Unknown"] as const]
					: []),
				["Template", template],
			]}
		/>
	);
}
