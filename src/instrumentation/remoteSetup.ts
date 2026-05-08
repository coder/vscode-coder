import type { TelemetryService } from "../telemetry/service";

export type RemoteSetupPhase =
	| "workspace_lookup"
	| "workspace_ready"
	| "resolve_agent"
	| "ssh_config_write";

/** Outcome on the parent `remote.setup` event for non-throwing early exits. */
export type RemoteSetupOutcome = "workspace_not_found" | "incompatible_server";

/** Helpers scoped to the remote.setup trace's lifetime. */
export interface RemoteSetupTracer {
	phase<T>(name: RemoteSetupPhase, fn: () => T | PromiseLike<T>): Promise<T>;
	/** Annotate the parent event for non-throwing exits (e.g. workspace 404). */
	setOutcome(outcome: RemoteSetupOutcome): void;
}

/** Emits `remote.setup` with typed child phases and an `outcome` property. */
export class RemoteSetupTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: (tracer: RemoteSetupTracer) => Promise<T>): Promise<T> {
		return this.telemetry.trace("remote.setup", (span) =>
			fn({
				phase: (name, phaseFn) =>
					span.phase(name, () => Promise.resolve(phaseFn())),
				setOutcome: (outcome) => span.setProperty("outcome", outcome),
			}),
		);
	}
}
