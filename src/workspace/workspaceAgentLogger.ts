import { extractAgents } from "../api/api-helper";
import { TransitionTracker } from "../util/transitionTracker";

import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceAgentStatus,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

/** Sentinel for the "from" side before any state is observed. `"unknown"` is a
 * real server-reported value, so avoid it. */
const INITIAL_STATE = "none";

interface AgentState {
	readonly status: WorkspaceAgentStatus;
	readonly lifecycleState: WorkspaceAgentLifecycle;
}

/**
 * Logs agent status and lifecycle transitions at `info` level so connection
 * debugging has a record of state changes correlated by the session ID. Mirrors
 * `WorkspaceAgentTelemetry` but tracks every agent (keyed by agent ID) for the
 * connection's lifetime, since a workspace can have several and they change
 * independently of the workspace status. Construct one per workspace;
 * `WorkspaceMonitor` is the sole call site.
 */
export class WorkspaceAgentLogger {
	private readonly tracker = new TransitionTracker<AgentState>(
		(a, b) => a.status === b.status && a.lifecycleState === b.lifecycleState,
	);

	public constructor(
		private readonly logger: Logger,
		private readonly workspaceName: string,
	) {}

	public observe(workspace: Workspace): void {
		for (const agent of extractAgents(workspace.latest_build.resources)) {
			const next: AgentState = {
				status: agent.status,
				lifecycleState: agent.lifecycle_state,
			};
			const change = this.tracker.observe(next, agent.id);
			if (!change) {
				continue;
			}

			this.logger.info(
				`Workspace ${this.workspaceName} agent ${agent.name} state changed`,
				{
					status: {
						from: change.from?.status ?? INITIAL_STATE,
						to: next.status,
					},
					lifecycleState: {
						from: change.from?.lifecycleState ?? INITIAL_STATE,
						to: next.lifecycleState,
					},
				},
			);
		}
	}
}
