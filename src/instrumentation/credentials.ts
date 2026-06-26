import { isAbortError } from "../error/errorUtils";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type CredentialErrorCategory = "binary" | "cli";

type CredentialEvent = "auth.credential.store" | "auth.credential.clear";

/**
 * Wraps credential store/clear in a span carrying `keyring_enabled`, the
 * `category` of storage involved, and an `error.type` on failure. The
 * traced operation sets `category` on the span and reports failures by
 * throwing a categorized error (store) or recording on the span (clear, which
 * is best-effort). Aborts are recorded and re-thrown so callers still unwind.
 */
export class CredentialTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceStore(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<void>,
	): Promise<void> {
		return this.trace("auth.credential.store", configs, fn);
	}

	public traceClear(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<void>,
	): Promise<void> {
		return this.trace("auth.credential.clear", configs, fn);
	}

	private async trace(
		eventName: CredentialEvent,
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<void>,
	): Promise<void> {
		const keyringEnabled = isKeyringEnabled(configs);
		let aborted: Error | undefined;
		await this.telemetry.trace(
			eventName,
			async (span) => {
				try {
					await fn(span);
				} catch (error) {
					if (isAbortError(error)) {
						span.markAborted();
						aborted = error;
						return;
					}
					span.setProperty("error.type", categorizeCredentialError(error));
					throw error;
				}
			},
			{
				keyring_enabled: keyringEnabled,
				category: keyringEnabled ? "keyring" : "file",
			},
		);
		if (aborted) {
			throw aborted;
		}
	}
}

function categorizeCredentialError(error: unknown): CredentialErrorCategory {
	if (error instanceof CredentialCliError) {
		return "cli";
	}
	return "binary";
}

export class CredentialCliError extends Error {
	public constructor(cause: unknown) {
		super("Credential CLI operation failed", { cause });
		this.name = "CredentialCliError";
	}
}
