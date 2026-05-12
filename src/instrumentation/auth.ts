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

interface LoginPromptResult {
	readonly success: boolean;
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

	public traceLoginPrompt<T extends LoginPromptResult>(
		trigger: AuthLoginPromptTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login_prompt",
			async (span) => {
				const result = await fn();
				if (!result.success) {
					span.markAborted();
				}
				return result;
			},
			{ trigger },
		);
	}
}
