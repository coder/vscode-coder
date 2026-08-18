import { TransitionTracker } from "../util/transitionTracker";

import type {
	Workspace,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";

/** Sentinel for the "from" side before any state is observed. `"unknown"` is a
 * real server-reported value, so avoid it. */
const INITIAL_STATE = "none";

/**
 * Logs workspace status transitions at `info` level so connection debugging has
 * a record of state changes correlated by the session ID. Mirrors
 * `WorkspaceStateTelemetry`: one log per workspace state change, independent of
 * how many agents the workspace has. Construct one per workspace;
 * `WorkspaceMonitor` is the sole call site.
 */
export class WorkspaceStateLogger {
	private readonly tracker = new TransitionTracker<WorkspaceStatus>(
		(a, b) => a === b,
	);

	public constructor(
		private readonly logger: Logger,
		private readonly workspaceName: string,
	) {}

	public observe(workspace: Workspace): void {
		const status = workspace.latest_build.status;
		const change = this.tracker.observe(status);
		if (!change) {
			return;
		}

		this.logger.info(`Workspace ${this.workspaceName} state changed`, {
			status: { from: change.from ?? INITIAL_STATE, to: status },
		});
	}
}
