import type { TelemetryService } from "../telemetry/service";

export type ActivationAuthState = "none" | "valid_token" | "expired";

/** Helpers scoped to the activation trace's lifetime. */
export interface ActivationTracer {
	setAuthState(state: ActivationAuthState): void;
	traceDeploymentInit(fn: () => Promise<boolean>): Promise<boolean>;
}

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
