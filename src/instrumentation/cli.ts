import { isAbortError } from "../error/errorUtils";

import type { CallerProperties, CallerPropertyValue } from "../telemetry/event";
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
		return this.telemetry.trace("cli.configure", (span) =>
			fn(this.createConfigureTrace(span, options)),
		);
	}

	private createConfigureTrace(
		span: Span,
		options: CliConfigureOptions,
	): CliConfigureTrace {
		span.setProperty("silent", options.silent);
		span.setProperty("credential_source", options.credentialSource);
		return new CliConfigureTrace(span);
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

	public async cacheLookup<T extends { readonly source: CliCacheSource }>(
		fn: () => Promise<T>,
	): Promise<T> {
		const result = await tracedPhase(
			this.span,
			"cache_lookup",
			{ source: (r) => r.source },
			fn,
		);
		this.span.setProperty("cache_source", result.source);
		return result;
	}

	public async versionCheck<
		T extends { readonly outcome: CliVersionCheckOutcome },
	>(fn: () => Promise<T>): Promise<T> {
		const result = await tracedPhase(
			this.span,
			"version_check",
			{ outcome: (r) => r.outcome },
			fn,
		);
		this.span.setProperty("version_check", result.outcome);
		return result;
	}

	public recordDownloadDecision(options: {
		readonly reason: CliDownloadReason;
		readonly action: CliDownloadAction;
	}): Promise<void> {
		this.span.setProperty("download_reason", options.reason);
		return this.phase("download_decision", {
			reason: options.reason,
			outcome: options.action,
		});
	}

	public lockWait<T extends { readonly waited: boolean }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return tracedPhase(this.span, "lock_wait", { waited: (r) => r.waited }, fn);
	}

	public lockWaitRecheck<
		T extends { readonly outcome: CliVersionCheckOutcome },
	>(fn: () => Promise<T>): Promise<T> {
		return tracedPhase(
			this.span,
			"lock_wait_recheck",
			{ outcome: (r) => r.outcome },
			fn,
		);
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

	private phase(name: string, properties: CallerProperties): Promise<void> {
		return this.span.phase(name, (span) => {
			for (const [key, value] of Object.entries(properties)) {
				span.setProperty(key, value);
			}
			return Promise.resolve();
		});
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

function tracedPhase<T>(
	span: Span,
	name: string,
	properties: Readonly<Record<string, (result: T) => CallerPropertyValue>>,
	fn: () => Promise<T>,
): Promise<T> {
	return span.phase(name, async (child) => {
		const result = await fn();
		for (const [key, select] of Object.entries(properties)) {
			child.setProperty(key, select(result));
		}
		return result;
	});
}

function categorizeConfigureFailure(
	error: unknown,
): CliConfigureFailureCategory {
	if (isAbortError(error)) {
		return "cancelled";
	}
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && code.startsWith("E")) {
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
