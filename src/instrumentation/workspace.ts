import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

import type {
	BuildReason,
	Workspace,
	WorkspaceAgent,
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

interface ObservedWorkspaceState {
	readonly status: WorkspaceStatus;
	readonly observedAtMs: number;
}

interface ObservedAgentState {
	readonly status: WorkspaceAgentStatus;
	readonly lifecycleState: WorkspaceAgentLifecycle;
	readonly observedAtMs: number;
}

export class WorkspaceTelemetry {
	private observedWorkspaceState: ObservedWorkspaceState | undefined;
	private observedAgentState: ObservedAgentState | undefined;

	public constructor(
		private readonly telemetry: TelemetryReporter = NOOP_TELEMETRY_REPORTER,
	) {}

	public observeWorkspace(workspace: Workspace): void {
		const status = workspace.latest_build.status;
		const now = performance.now();
		const previous = this.observedWorkspaceState;
		if (previous?.status === status) {
			return;
		}

		this.workspaceStateTransition({
			from: previous?.status ?? INITIAL_STATE,
			to: status,
			transition: workspace.latest_build.transition,
			reason: workspace.latest_build.reason,
			...(previous && {
				observedDurationMs: now - previous.observedAtMs,
			}),
		});
		this.observedWorkspaceState = { status, observedAtMs: now };
	}

	public observeAgent(agent: WorkspaceAgent): void {
		const now = performance.now();
		const previous = this.observedAgentState;
		if (
			previous?.status === agent.status &&
			previous.lifecycleState === agent.lifecycle_state
		) {
			return;
		}

		this.agentStateTransition({
			agentName: agent.name,
			fromStatus: previous?.status ?? INITIAL_STATE,
			toStatus: agent.status,
			fromLifecycleState: previous?.lifecycleState ?? INITIAL_STATE,
			toLifecycleState: agent.lifecycle_state,
			...(previous && { observedDurationMs: now - previous.observedAtMs }),
		});
		this.observedAgentState = {
			status: agent.status,
			lifecycleState: agent.lifecycle_state,
			observedAtMs: now,
		};
	}

	public resetAgent(): void {
		this.observedAgentState = undefined;
	}

	private workspaceStateTransition(transition: WorkspaceStateTransition): void {
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

	private agentStateTransition(
		transition: WorkspaceAgentStateTransition,
	): void {
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
