import { IconButton } from "@repo/ui";

import type { OpenWorkspaceParams } from "@repo/shared";

import type { WorkspacesApiClient } from "../../hooks/useWorkspaces";

export function OpenActions({
	name,
	target,
	api,
}: {
	name: string;
	target: OpenWorkspaceParams;
	api: WorkspacesApiClient;
}) {
	return (
		<>
			<IconButton
				icon="play"
				label={`Open ${name} in VS Code`}
				tooltip="Open in VS Code"
				onClick={() => api.openWorkspace(target)}
			/>
			<IconButton
				icon="link-external"
				label={`View ${name} in dashboard`}
				tooltip="View in Dashboard"
				onClick={() =>
					api.viewInDashboard({
						workspaceId: target.workspaceId,
						page: "workspace",
					})
				}
			/>
		</>
	);
}
