import { isAbortError } from "../error/errorUtils";

import type { CallerPropertyValue } from "../telemetry/event";
import type { TelemetryService } from "../telemetry/service";
import type { Span } from "../telemetry/span";

export type CliCacheSource = "file-path" | "directory" | "not-found";
export type CliDownloadReason = "missing" | "version_mismatch" | "unreadable";
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
		options: { silent: boolean; hasToken: boolean },
		fn: (trace: CliConfigureTrace) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("cli.configure", (span) => {
			span.setProperty("silent", options.silent);
			span.setProperty(
				"credentialSource",
				options.hasToken ? "session_token" : "empty_token",
			);
			return fn(new CliConfigureTrace(span));
		});
	}
}

export class CliResolveTrace {
	public constructor(private readonly span: Span) {}

	public setDownloadsEnabled(enabled: boolean): void {
		this.span.setProperty("downloadsEnabled", enabled);
	}

	public setOutcome(outcome: CliResolveOutcome): void {
		this.span.setProperty("outcome", outcome);
	}

	public setFailure(category: CliResolveFailureCategory | "unknown"): void {
		this.span.setProperty("failureCategory", category);
	}

	public async cacheLookup<T extends { readonly source: CliCacheSource }>(
		fn: () => Promise<T>,
	): Promise<T> {
		const result = await tracedPhase(
			this.span,
			"cache_lookup",
			"source",
			(r) => r.source,
			fn,
		);
		this.span.setProperty("cacheSource", result.source);
		return result;
	}

	public async versionCheck<
		T extends { readonly outcome: CliVersionCheckOutcome },
	>(fn: () => Promise<T>): Promise<T> {
		const result = await tracedPhase(
			this.span,
			"version_check",
			"outcome",
			(r) => r.outcome,
			fn,
		);
		this.span.setProperty("versionCheck", result.outcome);
		return result;
	}

	public downloadDecision(
		reason: CliDownloadReason,
		downloadsEnabled: boolean,
		hasExistingBinary: boolean,
	): Promise<void> {
		this.span.setProperty("downloadReason", reason);
		return this.span.phase("download_decision", (span) => {
			span.setProperty("reason", reason);
			span.setProperty("downloadsEnabled", downloadsEnabled);
			span.setProperty(
				"outcome",
				downloadsEnabled
					? "download"
					: hasExistingBinary
						? "fallback"
						: "blocked",
			);
			return Promise.resolve();
		});
	}

	public lockWait<T extends { readonly waited: boolean }>(
		fn: () => Promise<T>,
	): Promise<T> {
		return tracedPhase(this.span, "lock_wait", "waited", (r) => r.waited, fn);
	}

	public lockWaitRecheck<
		T extends { readonly outcome: CliVersionCheckOutcome },
	>(fn: () => Promise<T>): Promise<T> {
		return tracedPhase(
			this.span,
			"lock_wait_recheck",
			"outcome",
			(r) => r.outcome,
			fn,
		);
	}

	public async fallback<T>(error: unknown, fn: () => Promise<T>): Promise<T> {
		const result = await this.span.phase(
			"fallback_to_existing_binary",
			async (span) => {
				span.setProperty("failureCategory", categorizeResolveFailure(error));
				return fn();
			},
		);
		this.setOutcome("fallback_to_existing_binary");
		return result;
	}
}

export class CliConfigureTrace {
	public constructor(private readonly span: Span) {}

	public stored(mode: "keyring" | "file"): void {
		this.span.setProperty("configMode", mode);
	}

	public cancelled(): void {
		this.span.setProperty("failureCategory", "cancelled");
		this.span.markAborted();
	}

	public failed(error: unknown): void {
		this.span.setProperty("failureCategory", categorizeConfigureFailure(error));
	}
}

/** Run `fn` as a child phase, tagging the child span with `key = select(result)`. */
function tracedPhase<T>(
	span: Span,
	name: string,
	key: string,
	select: (result: T) => CallerPropertyValue,
	fn: () => Promise<T>,
): Promise<T> {
	return span.phase(name, async (child) => {
		const result = await fn();
		child.setProperty(key, select(result));
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
	if (!(error instanceof Error)) {
		return "download";
	}
	const message = error.message.toLowerCase();
	if (message === "unable to download cli because downloads are disabled") {
		return "downloads_disabled";
	}
	return message.includes("declined") || message.includes("aborted")
		? "fallback_declined"
		: "download";
}
