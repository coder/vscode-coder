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

/** Statuses where a provisioner job is actively running. */
const PROVISIONING_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
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

/**
 * Emits `workspace.state_transitioned` as a workspace progresses through
 * statuses, plus `buildDurationMs` when a provisioner run resolves.
 * Construct one per workspace; `WorkspaceMonitor` is the sole call site.
 */
export class WorkspaceStateTelemetry {
	private observed: ObservedWorkspaceState | undefined;
	/** Set on first observation of a provisioning status; cleared when the build resolves. */
	private buildStartedAtMs: number | undefined;

	public constructor(
		private readonly telemetry: TelemetryReporter,
		private readonly workspaceName: string,
	) {}

	public observe(workspace: Workspace): void {
		const { status, transition, reason } = workspace.latest_build;
		const previous = this.observed;
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

		const wasProvisioning =
			previous && PROVISIONING_STATUSES.has(previous.status);
		const isProvisioning = PROVISIONING_STATUSES.has(status);
		if (isProvisioning) {
			this.buildStartedAtMs ??= now;
		} else {
			if (wasProvisioning && this.buildStartedAtMs !== undefined) {
				measurements.buildDurationMs = now - this.buildStartedAtMs;
			}
			this.buildStartedAtMs = undefined;
		}

		this.telemetry.log(
			"workspace.state_transitioned",
			{
				workspaceName: this.workspaceName,
				from: previous?.status ?? INITIAL_STATE,
				to: status,
				transition,
				reason,
			},
			measurements,
		);
		this.observed = { status, transition, reason, observedAtMs: now };
	}
}

/**
 * Emits `workspace.agent.state_transitioned` as the agent's `status` and
 * `lifecycle_state` change. The agent has two state dimensions so the event
 * carries qualified `fromStatus`/`toStatus` and `fromLifecycleState`/
 * `toLifecycleState` properties. Construct one per workspace.
 */
export class WorkspaceAgentTelemetry {
	private observed: ObservedAgentState | undefined;

	public constructor(
		private readonly telemetry: TelemetryReporter,
		private readonly workspaceName: string,
	) {}

	public observe(agent: WorkspaceAgent): void {
		const previous = this.observed;
		if (
			previous?.status === agent.status &&
			previous.lifecycleState === agent.lifecycle_state
		) {
			return;
		}
		const now = performance.now();

		// Flat camelCase matches the codebase; switch to dot-namespaced grouping (from.status, from.lifecycleState, ...) if a third state dimension lands.
		this.telemetry.log(
			"workspace.agent.state_transitioned",
			{
				workspaceName: this.workspaceName,
				agentName: agent.name,
				fromStatus: previous?.status ?? INITIAL_STATE,
				toStatus: agent.status,
				fromLifecycleState: previous?.lifecycleState ?? INITIAL_STATE,
				toLifecycleState: agent.lifecycle_state,
			},
			previous ? { observedDurationMs: now - previous.observedAtMs } : {},
		);
		this.observed = {
			status: agent.status,
			lifecycleState: agent.lifecycle_state,
			observedAtMs: now,
		};
	}

	public reset(): void {
		this.observed = undefined;
	}
}

/**
 * Wraps user-initiated workspace operations (start, update) as traced spans.
 * Stateless; safe to construct per call site.
 */
export class WorkspaceOperationTelemetry {
	public constructor(
		private readonly telemetry: TelemetryReporter,
		private readonly workspaceName: string,
	) {}

	public traceUpdateTriggered<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", fn, {
			workspaceName: this.workspaceName,
		});
	}

	public traceStartTriggered<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.start.triggered", fn, {
			workspaceName: this.workspaceName,
		});
	}
}
