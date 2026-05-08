import type { TelemetryService } from "../telemetry/service";

/**
 * `none`: no stored token. `stored`: token present, not yet validated.
 * `valid_token`/`expired`: post-validation. `unknown`: validation threw.
 */
export type ActivationAuthState =
	| "none"
	| "stored"
	| "valid_token"
	| "expired"
	| "unknown";

/** Helpers scoped to the activation trace's lifetime. */
export interface ActivationTracer {
	setAuthState(state: ActivationAuthState): void;
	traceDeploymentInit(fn: () => Promise<boolean>): Promise<boolean>;
}

/**
 * Emits `activation` with `authState`, plus a sibling `activation.deployment_init`
 * trace (sibling, not child, because deployment init outlives the activation span).
 */
export class ActivationTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: (tracer: ActivationTracer) => Promise<T>): Promise<T> {
		return this.telemetry.trace("activation", async (span) => {
			span.setProperty("authState", "none");
			return fn({
				setAuthState: (state) => span.setProperty("authState", state),
				traceDeploymentInit: (initFn) =>
					this.telemetry.trace(
						"activation.deployment_init",
						async (childSpan) => {
							childSpan.setProperty("authState", "unknown");
							const success = await initFn();
							childSpan.setProperty(
								"authState",
								success ? "valid_token" : "expired",
							);
							return success;
						},
					),
			});
		});
	}
}
