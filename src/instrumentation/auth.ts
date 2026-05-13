import type { TelemetryReporter } from "../telemetry/reporter";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthIntercept401Recovery =
	| "refresh_success"
	| "login_required"
	| "none";
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

export class AuthTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refreshed", fn, { trigger });
	}

	/** Wraps the recovery+retry path for a 401; `setRecovery` records how it was handled. */
	public traceIntercept401<T>(
		fn: (
			setRecovery: (recovery: AuthIntercept401Recovery) => void,
		) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.unauthorized_intercepted", (span) =>
			fn((recovery) => span.setProperty("recovery", recovery)),
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
