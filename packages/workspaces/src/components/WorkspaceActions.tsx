import { Icon, MenuItem, MenuSeparator, type CodiconName } from "@repo/ui";

import { RowActions } from "./RowActions";

import type { Workspace } from "@repo/shared";
import type { WorkspaceStatus } from "coder/site/src/api/typesGenerated";

import type { WorkspaceCommands } from "./WorkspacesPanel";

type LifecycleAction = "Start" | "Stop" | "Restart" | "Retry";

const LIFECYCLE_ICONS: Readonly<Record<LifecycleAction, CodiconName>> = {
	Start: "play",
	Stop: "primitive-square",
	Restart: "debug-restart",
	Retry: "debug-restart",
};

function lifecycleActions(status: WorkspaceStatus): readonly LifecycleAction[] {
	switch (status) {
		case "running":
			return ["Stop", "Restart"];
		case "stopped":
			return ["Start"];
		case "failed":
		case "canceled":
			return ["Retry"];
		default:
			return [];
	}
}

export function WorkspaceActions({
	workspace,
	api,
}: {
	workspace: Workspace;
	api: WorkspaceCommands;
}) {
	const workspaceId = workspace.id;
	const actions = lifecycleActions(workspace.latest_build.status);
	return (
		<RowActions
			name={workspace.name || "Unknown"}
			target={{ workspaceId }}
			api={api}
			menuDescription="Disabled actions are not supported by this panel."
		>
			{actions.map((action) => (
				<MenuItem key={action} disabled>
					<Icon name={LIFECYCLE_ICONS[action]} />
					{action}
				</MenuItem>
			))}
			{actions.length > 0 && <MenuSeparator />}
			<MenuItem disabled>
				<Icon name="share" />
				Share
			</MenuItem>
			<MenuItem
				onClick={() => api.viewInDashboard({ workspaceId, page: "settings" })}
			>
				<Icon name="gear" />
				Settings
			</MenuItem>
			<MenuSeparator />
			<MenuItem disabled className="workspace-delete">
				<Icon name="trash" />
				Delete...
			</MenuItem>
		</RowActions>
	);
}
