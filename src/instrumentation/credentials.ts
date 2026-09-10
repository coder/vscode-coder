import { isAbortError } from "../error/errorUtils";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type CredentialErrorCategory = "binary" | "cli";

type CredentialEvent = "auth.credential.store" | "auth.credential.clear";

/**
 * Wraps credential store/clear in a span with `keyring_enabled`, the `store`
 * once the CLI is resolved, and `error.type` on failure. Aborts are recorded
 * and re-thrown.
 */
export class CredentialTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceStore(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<void>,
	): Promise<void> {
		return this.trace("auth.credential.store", configs, fn);
	}

	public traceClear<T>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		return this.trace("auth.credential.clear", configs, fn);
	}

	private async trace<T>(
		eventName: CredentialEvent,
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		let aborted: Error | undefined;
		let result: T | undefined;
		await this.telemetry.trace(
			eventName,
			async (span) => {
				try {
					result = await fn(span);
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
			{ keyring_enabled: isKeyringEnabled(configs) },
		);
		if (aborted) {
			throw aborted;
		}
		return result as T;
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
