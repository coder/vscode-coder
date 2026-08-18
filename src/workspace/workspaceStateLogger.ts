import { TransitionTracker } from "../util/transitionTracker";

import type {
	Workspace,
	WorkspaceBuild,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

/** Sentinel for the "from" side before any state is observed. `"unknown"` is a
 * real server-reported value, so avoid it. */
const INITIAL_STATE = "none";

interface ObservedWorkspaceState {
	readonly status: WorkspaceStatus;
	readonly transition: WorkspaceBuild["transition"];
	readonly reason: WorkspaceBuild["reason"];
}

/**
 * Logs workspace build transitions at `info` level so connection debugging has
 * a record of state changes correlated by the session ID. Mirrors
 * `WorkspaceStateTelemetry`: keyed on status, transition, and reason, so it logs
 * once per workspace state change regardless of how many agents the workspace
 * has. Construct one per workspace; `WorkspaceMonitor` is the sole call site.
 */
export class WorkspaceStateLogger {
	private readonly tracker = new TransitionTracker<ObservedWorkspaceState>(
		(a, b) =>
			a.status === b.status &&
			a.transition === b.transition &&
			a.reason === b.reason,
	);

	public constructor(
		private readonly logger: Logger,
		private readonly workspaceName: string,
	) {}

	public observe(workspace: Workspace): void {
		const { status, transition, reason } = workspace.latest_build;
		const change = this.tracker.observe({ status, transition, reason });
		if (!change) {
			return;
		}

		this.logger.info(`Workspace ${this.workspaceName} state changed`, {
			status: { from: change.from?.status ?? INITIAL_STATE, to: status },
			transition,
			reason,
		});
	}
}
