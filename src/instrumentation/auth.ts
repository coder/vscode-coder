import type { TelemetryReporter } from "../telemetry/reporter";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthRecoveryAction = "refresh_success" | "login_required" | "none";
export type AuthLoginPromptTrigger = "auth_required" | "missing_session";

/**
 * Why a login prompt ended without a session. `auth_failed` indicates
 * authentication itself failed; the others are user-driven aborts.
 */
export type LoginPromptReason =
	| "user_dismissed"
	| "no_url_provided"
	| "auth_failed";

export type LoginPromptOutcome =
	| { success: true }
	| { success: false; reason: LoginPromptReason };

/** Span annotator for the auth-recovery flow. Defaults to safe values. */
export interface AuthRecoveryRecorder {
	setRecovery(recovery: AuthRecoveryAction): void;
	setRefreshAttempted(attempted: boolean): void;
}

export class AuthTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refreshed", fn, { trigger });
	}

	/** Logged when a refresh call joins an in-flight refresh and emits no span of its own. */
	public tokenRefreshDeduped(trigger: AuthTokenRefreshTrigger): void {
		this.telemetry.log("auth.token_refresh.deduped", { trigger });
	}

	/**
	 * Wraps the auth-recovery path triggered by a 401. Initial properties
	 * cover the throw-before-callback case.
	 */
	public traceAuthRecovery<T>(
		fn: (recorder: AuthRecoveryRecorder) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.unauthorized_intercepted",
			(span) =>
				fn({
					setRecovery: (recovery) => span.setProperty("recovery", recovery),
					setRefreshAttempted: (attempted) =>
						span.setProperty("refreshAttempted", String(attempted)),
				}),
			{ recovery: "none", refreshAttempted: "false" },
		);
	}

	/**
	 * Records `auth.login_prompted`. `auth_failed` marks the span as failure;
	 * other non-success reasons mark it as aborted. The reason is copied to the
	 * span's `reason` property on failure/abort only.
	 */
	public traceLoginPrompt<T extends LoginPromptOutcome>(
		trigger: AuthLoginPromptTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login_prompted",
			async (span) => {
				const result = await fn();
				if (!result.success) {
					span.setProperty("reason", result.reason);
					if (result.reason === "auth_failed") {
						span.markFailure();
					} else {
						span.markAborted();
					}
				}
				return result;
			},
			{ trigger },
		);
	}
}
