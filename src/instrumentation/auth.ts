import type { TelemetryReporter } from "../telemetry/reporter";

export type AuthTokenRefreshTrigger = "background" | "reactive";
export type AuthRecoveryAction = "refresh_success" | "login_required" | "none";
export type AuthLoginPromptTrigger = "auth_required" | "missing_session";
export type AuthLoginSource =
	| "auto_login"
	| "command"
	| "direct"
	| "switch_deployment"
	| "uri";
export type AuthLoginMethod =
	| "unknown"
	| "mtls"
	| "provided_token"
	| "stored_token"
	| "keyring_token"
	| "legacy_token"
	| "oauth";

export type LoginPromptReason =
	| "user_dismissed"
	| "no_url_provided"
	| "auth_failed";
export type AuthLoginReason = LoginPromptReason | "exception";
export type AuthLogoutReason =
	| "not_authenticated"
	| "credential_clear_cancelled"
	| "credential_clear_failed"
	| "exception";

export type LoginPromptOutcome =
	| { success: true }
	| { success: false; reason: LoginPromptReason };
export type AuthLoginOutcome =
	| { success: true }
	| { success: false; reason: AuthLoginReason };
export type AuthLogoutOutcome =
	| { success: true }
	| { success: false; reason: AuthLogoutReason };

interface AuthRecoveryRecorder {
	logReceived(): void;
	setRecovery(recovery: AuthRecoveryAction): void;
	setRefreshAttempted(attempted: boolean): void;
}

export class AuthTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceLogin<T extends AuthLoginOutcome>(
		source: AuthLoginSource,
		getMethod: () => AuthLoginMethod,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace(
			"auth.login",
			async (span) => {
				const setMethod = () => span.setProperty("method", getMethod());
				try {
					const result = await fn();
					setMethod();
					if (!result.success) {
						span.setProperty("reason", result.reason);
						if (result.reason === "auth_failed") {
							span.markFailure();
						} else {
							span.markAborted();
						}
					}
					return result;
				} catch (error) {
					setMethod();
					span.setProperty("reason", "exception");
					throw error;
				}
			},
			{ source, method: "unknown" },
		);
	}

	public traceLogout<T extends AuthLogoutOutcome>(
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.logout", async (span) => {
			try {
				const result = await fn();
				if (!result.success) {
					span.setProperty("reason", result.reason);
					if (
						result.reason === "not_authenticated" ||
						result.reason === "credential_clear_cancelled"
					) {
						span.markAborted();
					} else {
						span.markFailure();
					}
				}
				return result;
			} catch (error) {
				span.setProperty("reason", "exception");
				throw error;
			}
		});
	}

	public traceTokenRefresh<T>(
		trigger: AuthTokenRefreshTrigger,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("auth.token_refreshed", fn, { trigger });
	}

	/** Logged when a refresh call joins an in-flight refresh and emits no span of its own. */
	public logTokenRefreshDeduped(trigger: AuthTokenRefreshTrigger): void {
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
					logReceived: () => span.log("received"),
					setRecovery: (recovery) => span.setProperty("recovery", recovery),
					setRefreshAttempted: (attempted) =>
						span.setProperty("refreshAttempted", attempted),
				}),
			{ recovery: "none", refreshAttempted: false },
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
