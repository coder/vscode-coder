import { extractAgents } from "../api/api-helper";

import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceBuild,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

/** Statuses where a provisioner job is actively running. */
const PROVISIONING_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
]);

/**
 * Tracks the last observed value per key and reports the previous value each
 * time it changes. Shared by the workspace/agent observers so transition
 * detection lives in one place.
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

/** Reported by `WorkspaceStateObserver`. */
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

/** Reported by `WorkspaceAgentObserver`. */
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

export interface RemovedAgent {
	readonly name: string;
}

export interface AgentObservation {
	readonly transitions: AgentStateTransition[];
	readonly removed: RemovedAgent[];
}

/**
 * Construct one per workspace.
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
