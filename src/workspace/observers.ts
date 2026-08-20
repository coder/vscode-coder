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
	readonly statusFrom: WorkspaceAgentStatus | undefined;
	readonly statusTo: WorkspaceAgentStatus;
	readonly lifecycleFrom: WorkspaceAgentLifecycle | undefined;
	readonly lifecycleTo: WorkspaceAgentLifecycle;
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
	private previous: ObservedWorkspaceState | undefined;
	/** Set on first observation of a provisioning status; cleared when the build resolves. */
	private buildStartedAtMs: number | undefined;

	public observe(workspace: Workspace): WorkspaceStateTransition | undefined {
		const {
			status,
			transition: buildTransition,
			reason: buildReason,
		} = workspace.latest_build;
		const now = performance.now();
		const previous = this.previous;

		if (
			previous?.status === status &&
			previous?.buildTransition === buildTransition &&
			previous?.buildReason === buildReason
		) {
			return undefined;
		}
		this.previous = { status, buildTransition, buildReason, observedAtMs: now };

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
}

/**
 * Construct one per workspace.
 */
export class WorkspaceAgentObserver {
	/** Previous observed state per agent ID, tracked independently. */
	private readonly previous = new Map<string, ObservedAgentState>();
	/** Last-seen agent name per ID, so removals can be reported by name. */
	private readonly names = new Map<string, string>();

	public observe(workspace: Workspace): AgentObservation {
		const now = performance.now();
		const transitions: AgentStateTransition[] = [];
		const seen = new Set<string>();

		for (const agent of extractAgents(workspace.latest_build.resources)) {
			seen.add(agent.id);
			this.names.set(agent.id, agent.name);
			const previous = this.previous.get(agent.id);
			if (
				previous?.status === agent.status &&
				previous?.lifecycleState === agent.lifecycle_state
			) {
				continue;
			}
			this.previous.set(agent.id, {
				status: agent.status,
				lifecycleState: agent.lifecycle_state,
				observedAtMs: now,
			});
			transitions.push({
				agentName: agent.name,
				statusFrom: previous?.status,
				statusTo: agent.status,
				lifecycleFrom: previous?.lifecycleState,
				lifecycleTo: agent.lifecycle_state,
				durationMs: previous ? now - previous.observedAtMs : undefined,
			});
		}

		const removed: RemovedAgent[] = [];
		for (const [id, name] of this.names) {
			if (!seen.has(id)) {
				removed.push({ name });
				this.names.delete(id);
				this.previous.delete(id);
			}
		}

		return { transitions, removed };
	}
}
