import { extractAgents } from "../api/api-helper";
import { WorkspaceUpdateCancelledError } from "../api/updateParameters";

import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceBuild,
	WorkspaceBuildParameter,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

/** Sentinel for `from*` before any state is observed. `"unknown"` is a real server-reported value, so avoid it. */
export const INITIAL_STATE = "none";

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

/**
 * Tracks the last observed value per key and reports the previous value each
 * time it changes. Shared by the workspace/agent observers and the corresponding
 * loggers so transition detection lives in one place.
 *
 * A single tracked entity (e.g. a workspace) can omit the key; callers that
 * track many entities (e.g. agents keyed by ID) pass a distinct key each time.
 */
export class TransitionTracker<T> {
	private readonly previous = new Map<string, T>();

	public constructor(private readonly equals: (a: T, b: T) => boolean) {}

	/**
	 * Record `next` for `key`. Returns `{ from }` when it differs from the last
	 * recorded value (`from` is `undefined` on the first observation), or
	 * `undefined` when unchanged.
	 */
	public observe(next: T, key = ""): { from: T | undefined } | undefined {
		const prior = this.previous.get(key);
		if (prior !== undefined && this.equals(prior, next)) {
			return undefined;
		}
		this.previous.set(key, next);
		return { from: prior };
	}

	/** Forget a single key, or all keys when `key` is omitted. */
	public reset(key?: string): void {
		if (key === undefined) {
			this.previous.clear();
		} else {
			this.previous.delete(key);
		}
	}
}

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

/** A detected workspace status change, reported by `WorkspaceStateObserver`. */
export interface WorkspaceStateTransition {
	/** Previous status, or `undefined` on the first observation. */
	readonly from: WorkspaceStatus | undefined;
	readonly to: WorkspaceStatus;
	readonly buildTransition: WorkspaceBuild["transition"];
	readonly buildReason: WorkspaceBuild["reason"];
	/** Time spent in the previous state; `undefined` on the first observation. */
	readonly durationMs: number | undefined;
	/** Set only on the observation where a provisioner run resolves. */
	readonly buildDurationMs: number | undefined;
}

/** A detected agent status/lifecycle change, reported by `WorkspaceAgentObserver`. */
export interface AgentStateTransition {
	readonly agentName: string;
	readonly status: {
		readonly from: WorkspaceAgentStatus | undefined;
		readonly to: WorkspaceAgentStatus;
	};
	readonly lifecycleState: {
		readonly from: WorkspaceAgentLifecycle | undefined;
		readonly to: WorkspaceAgentLifecycle;
	};
	/** Time since the previous observation of this agent; `undefined` on the first. */
	readonly durationMs: number | undefined;
}

/** An agent present on a prior observation and absent now (e.g. after a rebuild). */
export interface RemovedAgent {
	readonly name: string;
}

/** The result of observing all agents in a workspace snapshot. */
export interface AgentObservation {
	readonly transitions: AgentStateTransition[];
	readonly removed: RemovedAgent[];
}

/**
 * Detects workspace status changes as a workspace progresses through statuses,
 * reporting a transition object plus timing (including build duration when a
 * provisioner run resolves). Stateful but effect-free: it holds no logger or
 * telemetry references. Construct one per workspace.
 */
export class WorkspaceStateObserver {
	private readonly tracker = new TransitionTracker<ObservedWorkspaceState>(
		(a, b) =>
			a.status === b.status &&
			a.buildTransition === b.buildTransition &&
			a.buildReason === b.buildReason,
	);
	/** Set on first observation of a provisioning status; cleared when the build resolves. */
	private buildStartedAtMs: number | undefined;

	public observe(workspace: Workspace): WorkspaceStateTransition | undefined {
		const {
			status,
			transition: buildTransition,
			reason: buildReason,
		} = workspace.latest_build;
		const now = performance.now();
		const change = this.tracker.observe({
			status,
			buildTransition,
			buildReason,
			observedAtMs: now,
		});
		if (!change) {
			return undefined;
		}
		const previous = change.from;

		const wasProvisioning =
			previous && PROVISIONING_STATUSES.has(previous.status);
		const isProvisioning = PROVISIONING_STATUSES.has(status);
		let buildDurationMs: number | undefined;
		if (isProvisioning) {
			this.buildStartedAtMs ??= now;
		} else {
			if (wasProvisioning && this.buildStartedAtMs !== undefined) {
				buildDurationMs = now - this.buildStartedAtMs;
			}
			this.buildStartedAtMs = undefined;
		}

		return {
			from: previous?.status,
			to: status,
			buildTransition,
			buildReason,
			durationMs: previous ? now - previous.observedAtMs : undefined,
			buildDurationMs,
		};
	}

	public reset(): void {
		this.tracker.reset();
		this.buildStartedAtMs = undefined;
	}
}

/**
 * Detects agent status/lifecycle changes for every agent in a workspace,
 * keyed by agent ID so each is tracked independently, and reports agents that
 * have disappeared since the previous observation. Stateful but effect-free.
 * Construct one per workspace.
 */
export class WorkspaceAgentObserver {
	private readonly tracker = new TransitionTracker<ObservedAgentState>(
		(a, b) => a.status === b.status && a.lifecycleState === b.lifecycleState,
	);
	/** Last-seen agent name per ID, so removals can be reported by name. */
	private readonly names = new Map<string, string>();

	public observe(workspace: Workspace): AgentObservation {
		const now = performance.now();
		const transitions: AgentStateTransition[] = [];
		const seen = new Set<string>();

		for (const agent of extractAgents(workspace.latest_build.resources)) {
			seen.add(agent.id);
			this.names.set(agent.id, agent.name);
			const change = this.tracker.observe(
				{
					status: agent.status,
					lifecycleState: agent.lifecycle_state,
					observedAtMs: now,
				},
				agent.id,
			);
			if (!change) {
				continue;
			}
			const previous = change.from;
			transitions.push({
				agentName: agent.name,
				status: { from: previous?.status, to: agent.status },
				lifecycleState: {
					from: previous?.lifecycleState,
					to: agent.lifecycle_state,
				},
				durationMs: previous ? now - previous.observedAtMs : undefined,
			});
		}

		const removed: RemovedAgent[] = [];
		for (const [id, name] of this.names) {
			if (!seen.has(id)) {
				removed.push({ name });
				this.names.delete(id);
				this.tracker.reset(id);
			}
		}

		return { transitions, removed };
	}

	public reset(): void {
		this.tracker.reset();
		this.names.clear();
	}
}

/**
 * Emits `workspace.state_transitioned` for a detected workspace transition.
 * Telemetry only; pair with `WorkspaceStateObserver`.
 */
export function recordWorkspaceState(
	telemetry: TelemetryReporter,
	workspaceName: string,
	transition: WorkspaceStateTransition,
): void {
	const measurements: Record<string, number> = {};
	if (transition.durationMs !== undefined) {
		measurements.observed_duration_ms = transition.durationMs;
	}
	if (transition.buildDurationMs !== undefined) {
		measurements.observed_build_duration_ms = transition.buildDurationMs;
	}

	telemetry.log(
		"workspace.state_transitioned",
		{
			workspace_name: workspaceName,
			from: transition.from ?? INITIAL_STATE,
			to: transition.to,
			"build.transition": transition.buildTransition,
			"build.reason": transition.buildReason,
		},
		measurements,
	);
}

/**
 * Emits `workspace.agent.state_transitioned` for a detected agent transition.
 * Telemetry only; pair with `WorkspaceAgentObserver`.
 */
export function recordAgentState(
	telemetry: TelemetryReporter,
	workspaceName: string,
	transition: AgentStateTransition,
): void {
	telemetry.log(
		"workspace.agent.state_transitioned",
		{
			workspace_name: workspaceName,
			agent_name: transition.agentName,
			"status.from": transition.status.from ?? INITIAL_STATE,
			"status.to": transition.status.to,
			"lifecycle_state.from": transition.lifecycleState.from ?? INITIAL_STATE,
			"lifecycle_state.to": transition.lifecycleState.to,
		},
		transition.durationMs !== undefined
			? { observed_duration_ms: transition.durationMs }
			: {},
	);
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
			workspace_name: this.workspaceName,
		});
	}

	public traceStart<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.start.triggered", fn, {
			workspace_name: this.workspaceName,
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
			{ workspace_name: this.workspaceName, update_offered: outdated },
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
			workspace_name: this.workspaceName,
		});
	}
}
