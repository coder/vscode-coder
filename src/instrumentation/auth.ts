import type { LoginMethod } from "../login/loginCoordinator";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthRecoveryAction = "refresh_success" | "login_required" | "none";
export type AuthLoginPromptTrigger = "auth_required" | "missing_session";
export type AuthLoginSource =
	| "auto_login"
	| "command"
	| "switch_deployment"
	| "uri";

export type LoginPromptReason =
	| "user_dismissed"
	| "no_url_provided"
	| "auth_failed";

export type LoginPromptOutcome =
	| { success: true }
	| { success: false; reason: LoginPromptReason };
export type AuthLoginOutcome =
	| { success: true; method: LoginMethod }
	| { success: false; method?: LoginMethod; reason: LoginPromptReason };
export type AuthLogoutOutcome =
	| { success: true }
	| { success: false; reason: "not_authenticated" };

interface AuthLoginTrace {
	setMethod: (method: LoginMethod) => void;
}

interface AuthRecoveryRecorder {
	logReceived(): void;
	setRecovery(recovery: AuthRecoveryAction): void;
	setRefreshAttempted(attempted: boolean): void;
}

export class AuthTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceLogin<T extends AuthLoginOutcome>(
		source: AuthLoginSource,
		fn: (trace: AuthLoginTrace) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login",
			async (span) => {
				try {
					const result = await fn({
						setMethod: (method) => span.setProperty("method", method),
					});
					if (result.method) {
						span.setProperty("method", result.method);
					}
					if (!result.success) {
						recordReason(span, result.reason);
					}
					return result;
				} catch (error) {
					span.setProperty("error.type", "exception");
					throw error;
				}
			},
			{ source, method: "unknown" },
		);
	}

	public traceLogout(
		fn: () => Promise<AuthLogoutOutcome>,
	): Promise<AuthLogoutOutcome> {
		return this.telemetry.trace("auth.logout", async (span) => {
			try {
				const result = await fn();
				if (!result.success) {
					span.setProperty("reason", result.reason);
					span.markAborted();
				}
				return result;
			} catch (error) {
				span.setProperty("error.type", "exception");
				throw error;
			}
		});
	}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refresh.completed", fn, {
			trigger,
		});
	}

	/** Logged when a refresh call joins an in-flight refresh and emits no span of its own. */
	public logTokenRefreshDeduped(trigger: AuthTokenRefreshTrigger): void {
		this.telemetry.log("auth.token_refresh.deduped", { trigger });
	}

	/**
	 * Wraps the auth-recovery path triggered by a 401. Initial properties
	 * cover the throw-before-callback case.
	 */
	public traceRecovery<T>(
		fn: (recorder: AuthRecoveryRecorder) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.unauthorized_intercepted",
			(span) =>
				fn({
					logReceived: () => span.log("received"),
					setRecovery: (recovery) => span.setProperty("recovery", recovery),
					setRefreshAttempted: (attempted) =>
						span.setProperty("refresh_attempted", attempted),
				}),
			{ recovery: "none", refresh_attempted: false },
		);
	}

	/**
	 * Records `auth.login_prompted`. `auth_failed` marks the span as error;
	 * other non-success reasons mark it as aborted. The reason is copied to the
	 * span's `reason` property on error/abort only.
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
					recordReason(span, result.reason);
				}
				return result;
			},
			{ trigger },
		);
	}
}

/** `auth_failed` is a real error; user/URL dismissals are intentional aborts. */
function recordReason(span: Span, reason: LoginPromptReason): void {
	if (reason === "auth_failed") {
		span.setProperty("error.type", reason);
		span.markError();
	} else {
		span.setProperty("reason", reason);
		span.markAborted();
	}
}
