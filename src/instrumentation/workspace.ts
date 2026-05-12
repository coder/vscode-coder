import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

import type {
	BuildReason,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceStatus,
	WorkspaceTransition,
} from "coder/site/src/api/typesGenerated";

export const INITIAL_STATE = "unknown";

type InitialState = typeof INITIAL_STATE;

interface WorkspaceStateTransition {
	readonly from: WorkspaceStatus | InitialState;
	readonly to: WorkspaceStatus;
	readonly transition?: WorkspaceTransition;
	readonly reason?: BuildReason;
	readonly observedDurationMs?: number;
}

interface WorkspaceAgentStateTransition {
	readonly agentName: string;
	readonly fromStatus: WorkspaceAgentStatus | InitialState;
	readonly toStatus: WorkspaceAgentStatus;
	readonly fromLifecycleState: WorkspaceAgentLifecycle | InitialState;
	readonly toLifecycleState: WorkspaceAgentLifecycle;
	readonly observedDurationMs?: number;
}

export class WorkspaceTelemetry {
	public constructor(
		private readonly telemetry: TelemetryReporter = NOOP_TELEMETRY_REPORTER,
	) {}

	public workspaceStateTransition(transition: WorkspaceStateTransition): void {
		this.telemetry.log(
			"workspace.state_transitioned",
			{
				from: transition.from,
				to: transition.to,
				...(transition.transition && { transition: transition.transition }),
				...(transition.reason && { reason: transition.reason }),
			},
			transition.observedDurationMs === undefined
				? {}
				: { observedDurationMs: transition.observedDurationMs },
		);
	}

	public agentStateTransition(transition: WorkspaceAgentStateTransition): void {
		this.telemetry.log(
			"workspace.agent.state_transitioned",
			{
				agentName: transition.agentName,
				fromStatus: transition.fromStatus,
				toStatus: transition.toStatus,
				fromLifecycleState: transition.fromLifecycleState,
				toLifecycleState: transition.toLifecycleState,
			},
			transition.observedDurationMs === undefined
				? {}
				: { observedDurationMs: transition.observedDurationMs },
		);
	}

	public traceUpdateTriggered<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", () => fn());
	}
}
