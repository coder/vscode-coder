import {
	agentDiagnostics,
	type AgentDiagnostic,
	type WorkspaceAgent,
} from "@repo/shared";
import { Icon, MenuItem, type CodiconName } from "@repo/ui";

import { RowActions } from "./RowActions";

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

export function AgentActions({
	workspaceId,
	agent,
	api,
}: {
	workspaceId: string;
	agent: WorkspaceAgent;
	api: WorkspaceCommands;
}) {
	const target = { workspaceId, agentId: agent.id };
	return (
		<RowActions name={agent.name || "Unknown"} target={target} api={api}>
			{agentDiagnostics(agent).map((diagnostic) => {
				const { label, icon } = DIAGNOSTIC_ENTRIES[diagnostic];
				return (
					<MenuItem
						key={diagnostic}
						onClick={() => api.runAgentDiagnostic({ ...target, diagnostic })}
					>
						<Icon name={icon} />
						{label}
					</MenuItem>
				);
			})}
		</RowActions>
	);
}
