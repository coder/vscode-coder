import {
	agentDiagnostics,
	type AgentDiagnostic,
	type Workspace,
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

const DIAGNOSTIC_ENTRIES: Readonly<Record<AgentDiagnostic, MenuEntry>> = {
	ping: { label: "Ping", icon: "pulse" },
	speedTest: { label: "Speed Test", icon: "dashboard" },
	supportBundle: { label: "Support Bundle", icon: "archive" },
};

function WorkspaceMenu({
	workspace,
	api,
}: {
	workspace: Workspace;
	api: WorkspaceCommands;
}) {
	const workspaceId = workspace.id;
	const status = workspace.latest_build.status;
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
		</>
	);
}

function AgentMenu({
	workspaceId,
	agent,
	api,
}: {
	workspaceId: string;
	agent: WorkspaceAgent;
	api: WorkspaceCommands;
}) {
	return agentDiagnostics(agent).map((diagnostic) => {
		const { label, icon } = DIAGNOSTIC_ENTRIES[diagnostic];
		return (
			<MenuItem
				key={diagnostic}
				onClick={() =>
					api.runAgentDiagnostic({
						workspaceId,
						agentId: agent.id,
						diagnostic,
					})
				}
			>
				<Icon name={icon} />
				{label}
			</MenuItem>
		);
	});
}

/** Row actions for a workspace, or for `agent` when given. */
export function WorkspaceActions({
	workspace,
	agent,
	api,
}: {
	workspace: Workspace;
	agent?: WorkspaceAgent;
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
						agent
							? undefined
							: "Disabled actions are not supported by this panel."
					}
				>
					{agent ? (
						<AgentMenu workspaceId={workspaceId} agent={agent} api={api} />
					) : (
						<WorkspaceMenu workspace={workspace} api={api} />
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
