import { isAbortError } from "../error/errorUtils";

import { CredentialFileError } from "./credentials";

import type { CallerPropertyValue } from "../telemetry/event";
import type { TelemetryService } from "../telemetry/service";
import type { Span } from "../telemetry/span";

export type CliCacheSource = "file-path" | "directory" | "not-found";
export type CliDownloadReason = "missing" | "version_mismatch" | "unreadable";
export type CliDownloadAction = "download" | "fallback" | "blocked";
export type CliCredentialSource = "session_token" | "empty_token";
export type CliResolveOutcome =
	| "cache_hit"
	| "downloaded"
	| "lock_wait_cache_hit"
	| "download_disabled_fallback"
	| "fallback_to_existing_binary";
export type CliVersionCheckOutcome =
	| "missing"
	| "match"
	| "mismatch"
	| "unreadable";
export type CliConfigureFailureCategory =
	| "cancelled"
	| "filesystem"
	| "credential_store"
	| "unknown";
export type CliResolveFailureCategory =
	| "downloads_disabled"
	| "download"
	| "fallback_declined";

interface CliConfigureOptions {
	readonly silent: boolean;
	readonly credentialSource: CliCredentialSource;
}

export class CliDownloadsDisabledError extends Error {
	public constructor() {
		super("Unable to download CLI because downloads are disabled");
		this.name = "CliDownloadsDisabledError";
	}
}

export class CliFallbackDeclinedError extends Error {
	public constructor(cause: unknown) {
		super(
			cause instanceof Error ? cause.message : "CLI binary fallback declined",
			{
				cause,
			},
		);
		this.name = "CliFallbackDeclinedError";
	}
}

export class CliTelemetry {
	public constructor(private readonly telemetry: TelemetryService) {}

	public resolve<T>(fn: (trace: CliResolveTrace) => Promise<T>): Promise<T> {
		return this.telemetry.trace("cli.resolve", (span) =>
			fn(new CliResolveTrace(span)),
		);
	}

	public download<T>(
		reason: CliDownloadReason,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("cli.download", fn, { reason });
	}

	public configure<T>(
		options: CliConfigureOptions,
		fn: (trace: CliConfigureTrace) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("cli.configure", (span) => {
			span.setProperty("silent", options.silent);
			span.setProperty("credential_source", options.credentialSource);
			return fn(new CliConfigureTrace(span));
		});
	}
}

export class CliResolveTrace {
	public constructor(private readonly span: Span) {}

	public setOutcome(outcome: CliResolveOutcome): void {
		this.span.setProperty("outcome", outcome);
	}

	public setFailure(category: CliResolveFailureCategory | "unknown"): void {
		this.span.setProperty("failure_category", category);
	}

	public cacheLookup<T extends { readonly source: CliCacheSource }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return this.tracedPhase("cache_lookup", fn, (r) => r.source, {
			child: "source",
			parent: "cache_source",
		});
	}

	public versionCheck<T extends { readonly outcome: CliVersionCheckOutcome }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return this.tracedPhase("version_check", fn, (r) => r.outcome, {
			child: "outcome",
			parent: "version_check",
		});
	}

	public lockWait<T extends { readonly waited: boolean }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return this.tracedPhase("lock_wait", fn, (r) => r.waited, {
			child: "waited",
		});
	}

	public lockRecheck<T extends { readonly outcome: CliVersionCheckOutcome }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return this.tracedPhase("lock_wait_recheck", fn, (r) => r.outcome, {
			child: "outcome",
		});
	}

	public downloadDecision(
		reason: CliDownloadReason,
		action: CliDownloadAction,
	): Promise<void> {
		this.span.setProperty("download_reason", reason);
		return this.span.phase("download_decision", () => Promise.resolve(), {
			reason,
			outcome: action,
		});
	}

	public async fallback<T>(error: unknown, fn: () => Promise<T>): Promise<T> {
		const result = await this.span.phase(
			"fallback_to_existing_binary",
			async (span) => {
				try {
					const result = await fn();
					span.setProperty("failure_category", categorizeResolveFailure(error));
					return result;
				} catch (fallbackError) {
					span.setProperty(
						"failure_category",
						categorizeResolveFailure(fallbackError),
					);
					throw fallbackError;
				}
			},
		);
		this.setOutcome("fallback_to_existing_binary");
		return result;
	}

	/**
	 * Run `fn` as a child phase tagged with `select(result)`, mirroring it onto
	 * the parent when `keys.parent` is given.
	 */
	private async tracedPhase<T>(
		name: string,
		fn: () => Promise<T>,
		select: (result: T) => CallerPropertyValue,
		keys: { readonly child: string; readonly parent?: string },
	): Promise<T> {
		const result = await this.span.phase(name, async (child) => {
			const value = await fn();
			child.setProperty(keys.child, select(value));
			return value;
		});
		if (keys.parent) {
			this.span.setProperty(keys.parent, select(result));
		}
		return result;
	}
}

export class CliConfigureTrace {
	public constructor(private readonly span: Span) {}

	public cancelled(): void {
		this.span.setProperty("failure_category", "cancelled");
		this.span.markAborted();
	}

	public failed(error: unknown): void {
		this.span.setProperty(
			"failure_category",
			categorizeConfigureFailure(error),
		);
	}
}

function categorizeConfigureFailure(
	error: unknown,
): CliConfigureFailureCategory {
	if (isAbortError(error)) {
		return "cancelled";
	}
	// A CredentialFileError is a file-write failure; anything else is keyring/CLI.
	if (error instanceof CredentialFileError) {
		return "filesystem";
	}
	return error instanceof Error ? "credential_store" : "unknown";
}

function categorizeResolveFailure(error: unknown): CliResolveFailureCategory {
	if (error instanceof CliDownloadsDisabledError) {
		return "downloads_disabled";
	}
	if (error instanceof CliFallbackDeclinedError) {
		return "fallback_declined";
	}
	return "download";
}
