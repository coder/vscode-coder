import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthIntercept401Recovery =
	| "refresh_success"
	| "login_required"
	| "none";
export type AuthLoginPromptTrigger = "auth_required" | "missing_session";

/** Helpers scoped to the auth.login_prompt trace's lifetime. */
export interface LoginPromptTracer {
	markAborted(): void;
}

export class AuthTelemetry {
	public constructor(
		private readonly telemetry: TelemetryReporter = NOOP_TELEMETRY_REPORTER,
	) {}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refresh", fn, { trigger });
	}

	public intercept401(recovery: AuthIntercept401Recovery): void {
		this.telemetry.log("auth.intercept_401", { recovery });
	}

	public traceLoginPrompt<T>(
		trigger: AuthLoginPromptTrigger,
		fn: (tracer: LoginPromptTracer) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login_prompt",
			(span) => fn({ markAborted: () => span.markAborted() }),
			{ trigger },
		);
	}
}
