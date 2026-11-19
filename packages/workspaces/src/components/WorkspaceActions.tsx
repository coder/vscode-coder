import {
	workspaceActions,
	type Workspace,
	type WorkspaceAction,
} from "@repo/shared";
import { Icon, MenuItem, MenuSeparator, type CodiconName } from "@repo/ui";

import { RowActions } from "./RowActions";

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
			{actions.includes("delete") && (
				<>
					<MenuSeparator />
					{actionItem("delete", "workspace-delete")}
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
	api: Pick<
		WorkspaceCommands,
		"openWorkspace" | "viewInDashboard" | "runWorkspaceAction"
	>;
}) {
	return (
		<RowActions
			name={workspace.name || "Unknown"}
			target={{ workspaceId: workspace.id }}
			api={api}
			menuDescription={
				pendingAction &&
				`${ACTION_LABELS[pendingAction].pending}. Actions that change the workspace are unavailable until it finishes.`
			}
		>
			<WorkspaceMenu
				workspace={workspace}
				pendingAction={pendingAction}
				api={api}
			/>
		</RowActions>
	);
}
