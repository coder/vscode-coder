import { WorkspaceUpdateCancelledError } from "../api/updateParameters";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceBuild,
	WorkspaceBuildParameter,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

/** Sentinel for `from*` before any state is observed. `"unknown"` is a real server-reported value, so avoid it. */
const INITIAL_STATE = "none";

/** Statuses where a provisioner job is actively running. */
const PROVISIONING_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
]);

export type WorkspacePromptAction = "start" | "update";
export type WorkspaceUpdatePrompt = "parameters" | "confirmation";

interface ObservedWorkspaceState {
	readonly status: WorkspaceStatus;
	readonly buildTransition: WorkspaceBuild["transition"];
	readonly buildReason: WorkspaceBuild["reason"];
	readonly observedAtMs: number;
}

interface ObservedAgentState {
	readonly status: WorkspaceAgentStatus;
	readonly lifecycleState: WorkspaceAgentLifecycle;
	readonly observedAtMs: number;
}

/**
 * Emits `workspace.state_transitioned` as a workspace progresses through
 * statuses, plus `observedBuildDurationMs` when a provisioner run resolves.
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
		const {
			status,
			transition: buildTransition,
			reason: buildReason,
		} = workspace.latest_build;
		const previous = this.observed;
		if (
			previous?.status === status &&
			previous.buildTransition === buildTransition &&
			previous.buildReason === buildReason
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
				measurements.observedBuildDurationMs = now - this.buildStartedAtMs;
			}
			this.buildStartedAtMs = undefined;
		}

		this.telemetry.log(
			"workspace.state_transitioned",
			{
				workspaceName: this.workspaceName,
				from: previous?.status ?? INITIAL_STATE,
				to: status,
				"build.transition": buildTransition,
				"build.reason": buildReason,
			},
			measurements,
		);
		this.observed = {
			status,
			buildTransition,
			buildReason,
			observedAtMs: now,
		};
	}
}

/**
 * Emits `workspace.agent.state_transitioned` as the agent's `status` and
 * `lifecycle_state` change. The agent has two state dimensions so the event
 * carries `status.*` and `lifecycle_state.*` properties. Construct one per
 * workspace.
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

		this.telemetry.log(
			"workspace.agent.state_transitioned",
			{
				workspaceName: this.workspaceName,
				agentName: agent.name,
				"status.from": previous?.status ?? INITIAL_STATE,
				"status.to": agent.status,
				"lifecycle_state.from": previous?.lifecycleState ?? INITIAL_STATE,
				"lifecycle_state.to": agent.lifecycle_state,
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

	public traceUpdate<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", fn, {
			workspaceName: this.workspaceName,
		});
	}

	public traceStart<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.start.triggered", fn, {
			workspaceName: this.workspaceName,
		});
	}

	public async traceStartPrompt(
		outdated: boolean,
		fn: () => Promise<WorkspacePromptAction | undefined>,
	): Promise<WorkspacePromptAction | undefined> {
		return this.telemetry.trace(
			"workspace.start.prompted",
			async (span) => {
				const action = await fn();
				if (!action) {
					span.markAborted();
					return undefined;
				}
				span.setProperty("action", action);
				return action;
			},
			{ workspaceName: this.workspaceName, update_offered: outdated },
		);
	}

	/**
	 * Records dismissal as `result: "aborted"`. The framework treats any throw
	 * as `result: "error"`, so we return inside the span and rethrow outside.
	 */
	public async traceParametersPrompt(
		fn: () => Promise<WorkspaceBuildParameter[]>,
	): Promise<WorkspaceBuildParameter[]> {
		let cancelled: WorkspaceUpdateCancelledError | undefined;
		const parameters = await this.traceUpdatePrompt(
			"parameters",
			async (span) => {
				try {
					return await fn();
				} catch (error) {
					if (error instanceof WorkspaceUpdateCancelledError) {
						span.markAborted();
						cancelled = error;
						return [];
					}
					throw error;
				}
			},
		);
		if (cancelled) {
			throw cancelled;
		}
		return parameters;
	}

	public traceConfirmationPrompt<T>(
		fn: () => Promise<T | undefined>,
	): Promise<T | undefined> {
		return this.traceUpdatePrompt("confirmation", async (span) => {
			const value = await fn();
			if (value === undefined) {
				span.markAborted();
				return undefined;
			}
			span.setProperty("action", "update");
			return value;
		});
	}

	private traceUpdatePrompt<T>(
		prompt: WorkspaceUpdatePrompt,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("workspace.update.prompted", fn, {
			prompt,
			workspaceName: this.workspaceName,
		});
	}
}
