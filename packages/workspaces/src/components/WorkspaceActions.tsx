import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	Icon,
	IconButton,
	MenuItem,
	MenuSeparator,
} from "@repo/ui";

import type { Workspace } from "@repo/shared";

import type { useWorkspaces } from "../hooks/useWorkspaces";

export type WorkspaceCommands = Pick<
	ReturnType<typeof useWorkspaces>["api"],
	"openWorkspace" | "viewInDashboard" | "refresh" | "setFilter" | "watchAgents"
>;

export function WorkspaceActions({
	workspaceId,
	name,
	agentId,
	status,
	api,
}: {
	workspaceId: string;
	name: string;
	agentId?: string;
	status?: Workspace["latest_build"]["status"];
	api: WorkspaceCommands;
}) {
	const lifecycleActions =
		status === "running"
			? ["Stop", "Restart"]
			: status === "stopped"
				? ["Start"]
				: status === "failed" || status === "canceled"
					? ["Retry"]
					: [];
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
			{!agentId && (
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
						aria-description="Disabled actions are not supported by this panel."
					>
						{lifecycleActions.map((label) => (
							<MenuItem key={label} disabled>
								<Icon
									name={
										label === "Start"
											? "play"
											: label === "Stop"
												? "primitive-square"
												: "debug-restart"
									}
								/>
								{label}
							</MenuItem>
						))}
						{lifecycleActions.length > 0 && <MenuSeparator />}
						<MenuItem
							onClick={() =>
								api.viewInDashboard({ workspaceId, page: "settings" })
							}
						>
							<Icon name="gear" />
							Settings
						</MenuItem>
						<MenuItem disabled>
							<Icon name="share" />
							Share
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
						<MenuSeparator />
						<MenuItem disabled className="workspace-delete">
							<Icon name="trash" />
							Delete...
						</MenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</>
	);
}
