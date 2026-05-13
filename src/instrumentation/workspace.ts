import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

const INITIAL_STATE = "unknown";

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
		const previous = this.observedWorkspaceState;
		if (previous?.status === status) {
			return;
		}
		const now = performance.now();

		this.telemetry.log(
			"workspace.state_transitioned",
			{
				from: previous?.status ?? INITIAL_STATE,
				to: status,
				...(workspace.latest_build.transition && {
					transition: workspace.latest_build.transition,
				}),
				...(workspace.latest_build.reason && {
					reason: workspace.latest_build.reason,
				}),
			},
			previous ? { observedDurationMs: now - previous.observedAtMs } : {},
		);
		this.observedWorkspaceState = { status, observedAtMs: now };
	}

	public observeAgent(agent: WorkspaceAgent): void {
		const previous = this.observedAgentState;
		if (
			previous?.status === agent.status &&
			previous.lifecycleState === agent.lifecycle_state
		) {
			return;
		}
		const now = performance.now();

		this.telemetry.log(
			"workspace.agent.state_transitioned",
			{
				agentName: agent.name,
				fromStatus: previous?.status ?? INITIAL_STATE,
				toStatus: agent.status,
				fromLifecycleState: previous?.lifecycleState ?? INITIAL_STATE,
				toLifecycleState: agent.lifecycle_state,
			},
			previous ? { observedDurationMs: now - previous.observedAtMs } : {},
		);
		this.observedAgentState = {
			status: agent.status,
			lifecycleState: agent.lifecycle_state,
			observedAtMs: now,
		};
	}

	public resetAgent(): void {
		this.observedAgentState = undefined;
	}

	public traceUpdateTriggered<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", fn);
	}
}
