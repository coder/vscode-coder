import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceAppStatus,
	WorkspaceAppStatusState,
	WorkspaceStatus,
} from "@repo/shared";

export type RowStatus =
	| WorkspaceStatus
	| WorkspaceAgentStatus
	| WorkspaceAgentLifecycle
	| WorkspaceAppStatusState
	| "unhealthy";

export type StatusTone = "running" | "pending" | "error" | "stopped";

const TONES = {
	running: "running",
	connected: "running",
	complete: "running",
	pending: "pending",
	working: "pending",
	connecting: "pending",
	starting: "pending",
	stopping: "pending",
	deleting: "pending",
	canceling: "pending",
	created: "pending",
	shutting_down: "pending",
	failed: "error",
	failure: "error",
	unhealthy: "error",
	timeout: "error",
	start_error: "error",
	start_timeout: "error",
	shutdown_error: "error",
	shutdown_timeout: "error",
	stopped: "stopped",
	canceled: "stopped",
	deleted: "stopped",
	disconnected: "stopped",
	off: "stopped",
	ready: "stopped",
	idle: "stopped",
} as const satisfies Record<RowStatus, StatusTone>;

/** Health is only meaningful for the build that is running. */
export function workspaceStatus(workspace: Workspace): RowStatus {
	const status = workspace.latest_build.status;
	return status === "running" && !workspace.health.healthy
		? "unhealthy"
		: status;
}

/** A connected agent reports its lifecycle until ready, then its health. */
export function agentStatus(agent: WorkspaceAgent): RowStatus {
	if (agent.status !== "connected") {
		return agent.status;
	}
	if (agent.lifecycle_state !== "ready") {
		return agent.lifecycle_state;
	}
	return agent.health.healthy ? "connected" : "unhealthy";
}

/** Apps report a history of statuses; only the newest is current. */
export function latestAppStatus(
	statuses: readonly WorkspaceAppStatus[],
): WorkspaceAppStatus | undefined {
	return statuses.reduce<WorkspaceAppStatus | undefined>(
		(latest, candidate) =>
			!latest ||
			Date.parse(candidate.created_at) > Date.parse(latest.created_at)
				? candidate
				: latest,
		undefined,
	);
}

export function statusTone(status: RowStatus): StatusTone {
	return TONES[status];
}

/** `start_timeout` reads as "Start timeout". */
export function formatStatus(status: RowStatus): string {
	const words = status.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}
