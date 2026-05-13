import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceBuild,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { TelemetryReporter } from "../telemetry/reporter";

const INITIAL_STATE = "unknown";

const BUILDING_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
]);

interface ObservedWorkspaceState {
	readonly status: WorkspaceStatus;
	readonly transition: WorkspaceBuild["transition"];
	readonly reason: WorkspaceBuild["reason"];
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
	/** Set on first observation of a building status; cleared when the build resolves. */
	private buildStartedAtMs: number | undefined;

	public constructor(private readonly telemetry: TelemetryReporter) {}

	public observeWorkspace(workspace: Workspace): void {
		const { status, transition, reason } = workspace.latest_build;
		const previous = this.observedWorkspaceState;
		if (
			previous?.status === status &&
			previous.transition === transition &&
			previous.reason === reason
		) {
			return;
		}

		const now = performance.now();
		const measurements: Record<string, number> = previous
			? { observedDurationMs: now - previous.observedAtMs }
			: {};

		const wasBuilding = previous && BUILDING_STATUSES.has(previous.status);
		const isBuilding = BUILDING_STATUSES.has(status);
		if (isBuilding) {
			this.buildStartedAtMs ??= now;
		} else {
			if (wasBuilding && this.buildStartedAtMs !== undefined) {
				measurements.buildDurationMs = now - this.buildStartedAtMs;
			}
			this.buildStartedAtMs = undefined;
		}

		this.telemetry.log(
			"workspace.state_transitioned",
			{
				from: previous?.status ?? INITIAL_STATE,
				to: status,
				transition,
				reason,
			},
			measurements,
		);
		this.observedWorkspaceState = {
			status,
			transition,
			reason,
			observedAtMs: now,
		};
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

	public traceUpdateTriggered<T>(
		workspaceName: string,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", fn, {
			workspaceName,
		});
	}

	public traceStartTriggered<T>(
		workspaceName: string,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("workspace.start.triggered", fn, {
			workspaceName,
		});
	}
}
