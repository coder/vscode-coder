import type { TelemetryReporter } from "../telemetry/reporter";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthIntercept401Recovery =
	| "refresh_success"
	| "login_required"
	| "none";
export type AuthLoginPromptTrigger = "auth_required" | "missing_session";

/** User-initiated reasons a login prompt ended without success. */
export type LoginPromptAbortReason = "user_dismissed" | "no_url_provided";
/** Non-user-initiated reasons a login prompt ended without success. */
export type LoginPromptFailureReason = "auth_failed";

/** Minimum shape `traceLoginPrompt` needs to classify a prompt outcome. */
export type LoginPromptOutcome =
	| { success: true }
	| {
			success: false;
			reason: LoginPromptAbortReason | LoginPromptFailureReason;
	  };

export class AuthTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refresh", fn, { trigger });
	}

	/** Wrap a 401 recovery; `setRecovery` records the outcome on the span. */
	public traceIntercept401<T>(
		fn: (
			setRecovery: (recovery: AuthIntercept401Recovery) => void,
		) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.intercept_401", (span) =>
			fn((recovery) => span.setProperty("recovery", recovery)),
		);
	}

	/**
	 * Record `auth.login_prompt`. The returned `LoginPromptOutcome` drives
	 * the span: success stays `success`, `auth_failed` maps to `markFailure`,
	 * any other reason maps to `markAborted`. The reason is always copied to
	 * the `outcome` property.
	 */
	public traceLoginPrompt<T extends LoginPromptOutcome>(
		trigger: AuthLoginPromptTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login_prompt",
			async (span) => {
				const result = await fn();
				if (result.success) {
					span.setProperty("outcome", "success");
				} else if (result.reason === "auth_failed") {
					span.setProperty("outcome", result.reason);
					span.markFailure();
				} else {
					span.setProperty("outcome", result.reason);
					span.markAborted();
				}
				return result;
			},
			{ trigger },
		);
	}
}
