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

import { OpenActions } from "./OpenActions";

import type { Workspace, WorkspaceStatus } from "@repo/shared";

import type { WorkspacesApiClient } from "../../hooks/useWorkspaces";

interface LifecycleAction {
	readonly label: string;
	readonly icon: CodiconName;
}

const RETRY: LifecycleAction = { label: "Retry", icon: "debug-restart" };

const LIFECYCLE_ACTIONS: Readonly<
	Partial<Record<WorkspaceStatus, readonly LifecycleAction[]>>
> = {
	running: [
		{ label: "Stop", icon: "primitive-square" },
		{ label: "Restart", icon: "debug-restart" },
	],
	stopped: [{ label: "Start", icon: "debug-continue" }],
	failed: [RETRY],
	canceled: [RETRY],
};

export function WorkspaceActions({
	workspace,
	api,
}: {
	workspace: Workspace;
	api: WorkspacesApiClient;
}) {
	const name = workspace.name || "Unknown";
	const lifecycleActions =
		LIFECYCLE_ACTIONS[workspace.latest_build.status] ?? [];
	return (
		<>
			<OpenActions
				name={name}
				target={{ workspaceId: workspace.id }}
				api={api}
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
				<DropdownMenuContent
					align="end"
					aria-description="Disabled actions are not supported by this panel."
				>
					{lifecycleActions.map(({ label, icon }) => (
						<MenuItem key={label} disabled>
							<Icon name={icon} />
							{label}
						</MenuItem>
					))}
					{lifecycleActions.length > 0 && <MenuSeparator />}
					<MenuItem disabled>
						<Icon name="share" />
						Share
					</MenuItem>
					<MenuItem
						onClick={() =>
							api.viewInDashboard({
								workspaceId: workspace.id,
								page: "settings",
							})
						}
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
					<MenuSeparator />
					<MenuItem disabled>
						<Icon name="trash" />
						Delete...
					</MenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
