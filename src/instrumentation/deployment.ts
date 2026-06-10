import type { TelemetryReporter } from "../telemetry/reporter";

export type DeploymentSuspendReason =
	| "auth_config_change"
	| "auth_failure"
	| "credentials_removed"
	| "logout";
export type DeploymentRecoveryTrigger =
	| "auth_config"
	| "cross_window"
	| "token_update";

export class DeploymentTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public suspended(reason: DeploymentSuspendReason): void {
		this.telemetry.log("deployment.suspended", { reason });
	}

	public recovered(trigger: DeploymentRecoveryTrigger): void {
		this.telemetry.log("deployment.recovered", { trigger });
	}

	public crossWindowDetected(): void {
		this.telemetry.log("deployment.cross_window.detected");
	}

	public authConfigRecoveryFailed(): void {
		this.telemetry.log("deployment.auth_config.recovery_failed");
	}
}
