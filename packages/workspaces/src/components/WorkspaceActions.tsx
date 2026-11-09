import {
	workspaceActions,
	type Workspace,
	type WorkspaceAction,
} from "@repo/shared";
import { Icon, MenuItem, MenuSeparator, type CodiconName } from "@repo/ui";

import { RowActions } from "./RowActions";

import type { WorkspaceCommands } from "./WorkspacesPanel";

interface MenuEntry {
	readonly label: string;
	readonly icon: CodiconName;
}

const ACTION_ENTRIES: Readonly<
	Record<Exclude<WorkspaceAction, "delete">, MenuEntry>
> = {
	update: { label: "Update", icon: "arrow-circle-up" },
	start: { label: "Start", icon: "play" },
	stop: { label: "Stop", icon: "primitive-square" },
	restart: { label: "Restart", icon: "debug-restart" },
};

const RETRY_ENTRY: MenuEntry = { label: "Retry", icon: "debug-restart" };

function WorkspaceMenu({
	workspace,
	pendingAction,
	api,
}: {
	workspace: Workspace;
	pendingAction?: WorkspaceAction;
	api: WorkspaceCommands;
}) {
	const workspaceId = workspace.id;
	const actions = workspaceActions(workspace);
	const busy = pendingAction !== undefined;
	// A failed build is retried by repeating its transition.
	const failed = workspace.latest_build.status === "failed";
	const lifecycle = actions.filter((action) => action !== "delete");
	return (
		<>
			{lifecycle.map((action) => {
				const { label, icon } =
					failed && action !== "update" ? RETRY_ENTRY : ACTION_ENTRIES[action];
				return (
					<MenuItem
						key={action}
						disabled={busy}
						onClick={() => api.runWorkspaceAction({ workspaceId, action })}
					>
						<Icon name={icon} />
						{label}
					</MenuItem>
				);
			})}
			{lifecycle.length > 0 && <MenuSeparator />}
			<MenuItem
				onClick={() => api.viewInDashboard({ workspaceId, page: "sharing" })}
			>
				<Icon name="share" />
				Share
			</MenuItem>
			<MenuItem
				onClick={() => api.viewInDashboard({ workspaceId, page: "settings" })}
			>
				<Icon name="gear" />
				Settings
			</MenuItem>
			{actions.includes("delete") && (
				<>
					<MenuSeparator />
					<MenuItem
						className="workspace-delete"
						disabled={busy}
						onClick={() =>
							api.runWorkspaceAction({ workspaceId, action: "delete" })
						}
					>
						<Icon name="trash" />
						Delete...
					</MenuItem>
				</>
			)}
		</>
	);
}

export function WorkspaceActions({
	workspace,
	pendingAction,
	api,
}: {
	workspace: Workspace;
	/** Disables the workspace's lifecycle actions while one runs. */
	pendingAction?: WorkspaceAction;
	api: WorkspaceCommands;
}) {
	return (
		<RowActions
			name={workspace.name || "Unknown"}
			target={{ workspaceId: workspace.id }}
			api={api}
		>
			<WorkspaceMenu
				workspace={workspace}
				pendingAction={pendingAction}
				api={api}
			/>
		</RowActions>
	);
}
