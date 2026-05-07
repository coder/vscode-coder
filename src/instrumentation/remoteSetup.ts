import type { Span } from "../telemetry/span";

export type RemoteSetupPhase =
	| "auth_retrieval"
	| "workspace_lookup"
	| "workspace_ready"
	| "agent_ready"
	| "ssh_config_write";

export class RemoteSetupTelemetry {
	public constructor(private readonly span: Span) {}

	public phase<T>(
		phaseName: RemoteSetupPhase,
		fn: () => T | PromiseLike<T>,
	): Promise<T> {
		return this.span.phase(phaseName, () => Promise.resolve(fn()));
	}
}
