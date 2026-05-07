import type { TelemetryService } from "../telemetry/service";
import type { Span } from "../telemetry/span";

export type ActivationAuthState = "none" | "valid_token" | "expired";

export class ActivationTelemetry {
	private authState: ActivationAuthState = "none";
	private span: Span | undefined;

	public constructor(private readonly telemetry: TelemetryService) {}

	public trace<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("activation", async (span) => {
			this.span = span;
			span.setProperty("authState", this.authState);
			try {
				return await fn();
			} finally {
				this.span = undefined;
			}
		});
	}

	public setAuthState(authState: ActivationAuthState): void {
		this.authState = authState;
		this.span?.setProperty("authState", authState);
	}

	public traceDeploymentInit(fn: () => Promise<boolean>): Promise<boolean> {
		const initialAuthState = this.authState;
		return this.telemetry.trace("activation.deployment_init", async (span) => {
			span.setProperty("authState", initialAuthState);
			const success = await fn();
			span.setProperty("authState", success ? "valid_token" : "expired");
			return success;
		});
	}
}
