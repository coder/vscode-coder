import type { TelemetryService } from "../telemetry/service";

export type RemoteSetupPhase =
	| "cli_resolve"
	| "cli_configure"
	| "compatibility_check"
	| "workspace_lookup"
	| "workspace_monitor_setup"
	| "workspace_ready"
	| "agent_resolve"
	| "ssh_config_write"
	| "ssh_monitor_setup"
	| "connection_handoff";

/** Reason for a non-throwing early exit from `remote.setup`. */
export type RemoteSetupOutcome = "workspace_not_found" | "incompatible_server";

/** Helpers scoped to the remote.setup trace's lifetime. */
export interface RemoteSetupTracer {
	/** Emit a typed child phase of `remote.setup`. */
	phase<T>(name: RemoteSetupPhase, fn: () => T | PromiseLike<T>): Promise<T>;
	/** Mark this setup as aborted with a typed reason; emits as `outcome` on the parent event. */
	markAborted(reason: RemoteSetupOutcome): void;
}

/** Emits `remote.setup` with typed child phases and an `outcome` property. */
export class RemoteSetupTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: (tracer: RemoteSetupTracer) => Promise<T>): Promise<T> {
		return this.telemetry.trace("remote.setup", (span) =>
			fn({
				phase: (name, phaseFn) =>
					span.phase(name, () => Promise.resolve(phaseFn())),
				markAborted: (reason) => {
					span.setProperty("outcome", reason);
					span.markAborted();
				},
			}),
		);
	}
}
