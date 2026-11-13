import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	IconButton,
} from "@repo/ui";

import type { OpenWorkspaceParams } from "@repo/shared";
import type { ReactNode } from "react";

import type { WorkspaceCommands } from "./WorkspacesPanel";

/** Open, dashboard and overflow menu buttons; `children` fill the menu. */
export function RowActions({
	name,
	target,
	api,
	menuDescription,
	children,
}: {
	name: string;
	target: OpenWorkspaceParams;
	api: Pick<WorkspaceCommands, "openWorkspace" | "viewInDashboard">;
	menuDescription?: string;
	children: ReactNode;
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
				<DropdownMenuContent align="end" aria-description={menuDescription}>
					{children}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
