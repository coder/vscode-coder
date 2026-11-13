import {
	workspaceActions,
	type Workspace,
	type WorkspaceAction,
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

interface ActionLabel {
	readonly label: string;
	readonly icon: CodiconName;
}

/** Each action's menu entry, and the status a row shows while it runs. */
export const ACTION_LABELS: Readonly<
	Record<WorkspaceAction, ActionLabel & { readonly pending: string }>
> = {
	update: { label: "Update", pending: "Updating", icon: "arrow-circle-up" },
	start: { label: "Start", pending: "Starting", icon: "play" },
	stop: { label: "Stop", pending: "Stopping", icon: "primitive-square" },
	restart: { label: "Restart", pending: "Restarting", icon: "debug-restart" },
	delete: { label: "Delete...", pending: "Deleting", icon: "trash" },
};

const RETRY: ActionLabel = { label: "Retry", icon: "debug-restart" };

const UNSUPPORTED =
	"Ping, Speed Test and Support Bundle are not supported by this panel yet.";

/** Open in VS Code and view in the dashboard, for a workspace or `agentId`. */
export function OpenActions({
	workspaceId,
	agentId,
	name,
	api,
}: {
	workspaceId: string;
	agentId?: string;
	name: string;
	api: Pick<WorkspaceCommands, "openWorkspace" | "viewInDashboard">;
}) {
	return (
		<>
			<IconButton
				icon="play"
				label={`Open ${name} in VS Code`}
				tooltip="Open in VS Code"
				onClick={() =>
					api.openWorkspace({ workspaceId, ...(agentId ? { agentId } : {}) })
				}
			/>
			<IconButton
				icon="link-external"
				label={`View ${name} in dashboard`}
				tooltip="View in Dashboard"
				onClick={() => api.viewInDashboard({ workspaceId, page: "workspace" })}
			/>
		</>
	);
}

/** A workspace row's open actions and its menu. */
export function WorkspaceActions({
	workspace,
	pendingAction,
	api,
}: {
	workspace: Workspace;
	/** Disables the workspace's lifecycle actions while one runs. */
	pendingAction?: WorkspaceAction;
	api: Pick<
		WorkspaceCommands,
		"openWorkspace" | "viewInDashboard" | "runWorkspaceAction"
	>;
}) {
	const name = workspace.name || "Unknown";
	return (
		<>
			<OpenActions workspaceId={workspace.id} name={name} api={api} />
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
					aria-description={
						pendingAction
							? `${ACTION_LABELS[pendingAction].pending}. Actions that change the workspace are unavailable until it finishes. ${UNSUPPORTED}`
							: UNSUPPORTED
					}
				>
					<WorkspaceMenu
						workspace={workspace}
						pendingAction={pendingAction}
						api={api}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

function WorkspaceMenu({
	workspace,
	pendingAction,
	api,
}: {
	workspace: Workspace;
	pendingAction?: WorkspaceAction;
	api: Pick<WorkspaceCommands, "viewInDashboard" | "runWorkspaceAction">;
}) {
	const workspaceId = workspace.id;
	const busy = pendingAction !== undefined;
	const actions = workspaceActions(workspace);
	// A failed build is retried by repeating its transition.
	const failed = workspace.latest_build.status === "failed";
	const actionItem = (action: WorkspaceAction, className?: string) => {
		const { label, icon } =
			failed && (action === "start" || action === "stop")
				? RETRY
				: ACTION_LABELS[action];
		return (
			<MenuItem
				key={action}
				className={className}
				disabled={busy}
				onClick={() => api.runWorkspaceAction({ workspaceId, action })}
			>
				<Icon name={icon} />
				{label}
			</MenuItem>
		);
	};
	const lifecycle = actions.filter((action) => action !== "delete");
	return (
		<>
			{lifecycle.map((action) => actionItem(action))}
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
					{actionItem("delete", "workspace-delete")}
				</>
			)}
		</>
	);
}
