import { extractAgents } from "../api/api-helper";

import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

/** Sentinel for the "from" side before any state is observed, and for the
 * agent/lifecycle dimensions while no agent exists yet. `"unknown"` is a real
 * server-reported value, so avoid it. */
const INITIAL_STATE = "none";

interface ObservedState {
	readonly workspaceStatus: WorkspaceStatus;
	readonly agentStatus: WorkspaceAgentStatus | typeof INITIAL_STATE;
	readonly lifecycleState: WorkspaceAgentLifecycle | typeof INITIAL_STATE;
}

/**
 * Logs workspace, agent, and lifecycle status transitions at `info` level so
 * connection debugging has a record of state changes correlated by the session
 * ID. Tracks state per agent (keyed by agent ID) because a workspace can have
 * several. Construct one per workspace; `WorkspaceMonitor` is the sole call
 * site.
 */
export class WorkspaceStateLogger {
	private readonly observed = new Map<string, ObservedState>();

	public constructor(
		private readonly logger: Logger,
		private readonly workspaceName: string,
	) {}

	public observe(workspace: Workspace): void {
		const workspaceStatus = workspace.latest_build.status;
		const agents = extractAgents(workspace.latest_build.resources);

		if (agents.length === 0) {
			this.observeState(INITIAL_STATE, {
				workspaceStatus,
				agentStatus: INITIAL_STATE,
				lifecycleState: INITIAL_STATE,
			});
			return;
		}

		for (const agent of agents) {
			this.observeState(agent.id, {
				workspaceStatus,
				agentStatus: agent.status,
				lifecycleState: agent.lifecycle_state,
			});
		}
	}

	private observeState(key: string, next: ObservedState): void {
		const previous = this.observed.get(key);
		if (
			previous?.workspaceStatus === next.workspaceStatus &&
			previous?.agentStatus === next.agentStatus &&
			previous?.lifecycleState === next.lifecycleState
		) {
			return;
		}

		this.logger.info(`Workspace ${this.workspaceName} state changed`, {
			workspaceStatus: {
				from: previous?.workspaceStatus ?? INITIAL_STATE,
				to: next.workspaceStatus,
			},
			agentStatus: {
				from: previous?.agentStatus ?? INITIAL_STATE,
				to: next.agentStatus,
			},
			lifecycleState: {
				from: previous?.lifecycleState ?? INITIAL_STATE,
				to: next.lifecycleState,
			},
		});

		this.observed.set(key, next);
	}
}
