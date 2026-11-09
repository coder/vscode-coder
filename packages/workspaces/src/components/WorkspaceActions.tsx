import {
	workspaceActions,
	type Workspace,
	type WorkspaceAction,
	type WorkspaceAgent,
} from "@repo/shared";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	Icon,
	IconButton,
	MenuItem,
	MenuSeparator,
	type CodiconName,
} from "@repo/ui";

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
			<MenuSeparator />
			<MenuItem disabled>
				<Icon name="pulse" />
				Ping
			</MenuItem>
			<MenuItem disabled>
				<Icon name="dashboard" />
				Speed Test
			</MenuItem>
			<MenuItem disabled>
				<Icon name="archive" />
				Support Bundle
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

/** Row actions for a workspace, or for `agent` when given. */
export function WorkspaceActions({
	workspace,
	agent,
	pendingAction,
	api,
}: {
	workspace: Workspace;
	agent?: WorkspaceAgent;
	/** Disables the workspace's lifecycle actions while one runs. */
	pendingAction?: WorkspaceAction;
	api: WorkspaceCommands;
}) {
	const workspaceId = workspace.id;
	const name = (agent ? agent.name : workspace.name) || "Unknown";
	return (
		<>
			<IconButton
				icon="play"
				label={`Open ${name} in VS Code`}
				tooltip="Open in VS Code"
				onClick={() =>
					api.openWorkspace({
						workspaceId,
						...(agent ? { agentId: agent.id } : {}),
					})
				}
			/>
			<IconButton
				icon="link-external"
				label={`View ${name} in dashboard`}
				tooltip="View in Dashboard"
				onClick={() => api.viewInDashboard({ workspaceId, page: "workspace" })}
			/>
			{!agent && (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<IconButton
								icon="more"
								label={`More actions for ${name}`}
								tooltip="More Actions"
							/>
						}
					/>
					<DropdownMenuContent
						align="end"
						aria-description="Ping, Speed Test and Support Bundle are not supported by this panel yet."
					>
						<WorkspaceMenu
							workspace={workspace}
							pendingAction={pendingAction}
							api={api}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</>
	);
}
