import type { TelemetryService } from "../telemetry/service";

/**
 * `none`: no stored token. `stored`: token present, not yet validated.
 * `valid_token`: server validation passed. `auth_failed`: validation returned
 * false (covers expiration, network/DNS, cert, server errors — the boolean
 * doesn't distinguish). `unknown`: validation threw before classification.
 */
export type ActivationAuthState =
	"none" | "stored" | "valid_token" | "auth_failed" | "unknown";

/** Helpers scoped to the activation trace's lifetime. */
export interface ActivationTracer {
	setAuthState(state: ActivationAuthState): void;
	traceDeploymentInit(fn: () => Promise<boolean>): Promise<boolean>;
}

/**
 * Emits `activation` with `auth_state`, plus a sibling `activation.deployment_init`
 * trace (sibling, not child, because deployment init outlives the activation span).
 */
export class ActivationTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: (tracer: ActivationTracer) => Promise<T>): Promise<T> {
		return this.telemetry.trace("activation", async (span) => {
			span.setProperty("auth_state", "none");
			return fn({
				setAuthState: (state) => span.setProperty("auth_state", state),
				traceDeploymentInit: (initFn) =>
					this.telemetry.trace(
						"activation.deployment_init",
						async (childSpan) => {
							childSpan.setProperty("auth_state", "unknown");
							const success = await initFn();
							childSpan.setProperty(
								"auth_state",
								success ? "valid_token" : "auth_failed",
							);
							return success;
						},
					),
			});
		});
	}
}
