import type { TelemetryService } from "../telemetry/service";

export type RemoteSetupPhase =
	| "auth_retrieval"
	| "workspace_lookup"
	| "workspace_ready"
	| "agent_ready"
	| "ssh_config_write";

/** Helpers scoped to the remote.setup trace's lifetime. */
export interface RemoteSetupTracer {
	phase<T>(name: RemoteSetupPhase, fn: () => T | PromiseLike<T>): Promise<T>;
}

export class RemoteSetupTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: (tracer: RemoteSetupTracer) => Promise<T>): Promise<T> {
		return this.telemetry.trace("remote.setup", (span) =>
			fn({
				phase: (name, phaseFn) =>
					span.phase(name, () => Promise.resolve(phaseFn())),
			}),
		);
	}
}
