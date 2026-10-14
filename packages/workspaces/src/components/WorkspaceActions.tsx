import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	Icon,
	IconButton,
	MenuItem,
	MenuSeparator,
} from "@repo/ui";

import type { useWorkspaces } from "../hooks/useWorkspaces";

export type WorkspaceCommands = Pick<
	ReturnType<typeof useWorkspaces>["api"],
	"openWorkspace" | "viewInDashboard" | "refresh" | "setFilter" | "watchAgents"
>;

export function WorkspaceActions({
	workspaceId,
	name,
	agentId,
	api,
}: {
	workspaceId: string;
	name: string;
	agentId?: string;
	api: WorkspaceCommands;
}) {
	return (
		<>
			<IconButton
				icon="play"
				label={`Open ${name} in VS Code`}
				onClick={() =>
					api.openWorkspace({ workspaceId, ...(agentId ? { agentId } : {}) })
				}
			/>
			<IconButton
				icon="link-external"
				label={`View ${name} in dashboard`}
				onClick={() => api.viewInDashboard({ workspaceId, page: "workspace" })}
			/>
			{!agentId && (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<IconButton icon="more" label={`More actions for ${name}`} />
						}
					/>
					<DropdownMenuContent
						align="end"
						aria-description="Disabled actions are not supported by this panel."
					>
						<MenuItem disabled>
							<Icon name="primitive-square" />
							Stop
						</MenuItem>
						<MenuItem disabled>
							<Icon name="debug-restart" />
							Restart
						</MenuItem>
						<MenuItem
							onClick={() =>
								api.viewInDashboard({ workspaceId, page: "settings" })
							}
						>
							<Icon name="gear" />
							Settings
						</MenuItem>
						<MenuItem disabled>
							<Icon name="history" />
							Change version
						</MenuItem>
						<MenuItem disabled>
							<Icon name="share" />
							Share
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
