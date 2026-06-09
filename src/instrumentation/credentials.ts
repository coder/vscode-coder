import { isAbortError } from "../error/errorUtils";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type CredentialCategory = "keyring" | "file";
export type CredentialFailureCategory = "aborted" | "binary" | "cli" | "file";

interface CredentialTrace {
	file<T>(fn: () => Promise<T>): Promise<T>;
	keyring<T>(fn: () => Promise<T>): Promise<T>;
}

export interface CredentialClearResult {
	readonly failureCategory?: CredentialFailureCategory;
}

export class CredentialTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public async traceStore<T>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (trace: CredentialTrace) => Promise<T>,
	): Promise<T> {
		return this.traceCredential("auth.credential.store", configs, fn);
	}

	public async traceClear<T extends CredentialClearResult>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (trace: CredentialTrace) => Promise<T>,
	): Promise<T> {
		return this.traceCredential(
			"auth.credential.clear",
			configs,
			fn,
			recordClearFailure,
		);
	}

	private async traceCredential<T>(
		eventName: "auth.credential.store" | "auth.credential.clear",
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (trace: CredentialTrace) => Promise<T>,
		recordResult?: (span: Span, result: T) => void,
	): Promise<T> {
		const defaults = defaultCredentialProperties(configs);
		let cancellation: unknown;
		const result = await this.telemetry.trace(
			eventName,
			async (span) => {
				try {
					const result = await fn(createCredentialTrace(span));
					recordResult?.(span, result);
					return result;
				} catch (error) {
					recordCredentialFailure(span, defaults.category, error);
					if (isAbortError(error)) {
						span.markAborted();
						cancellation = error;
						return undefined as T;
					}
					throw error;
				}
			},
			{
				keyring_enabled: defaults.keyringEnabled,
				category: defaults.category,
			},
		);
		if (cancellation instanceof Error) {
			throw cancellation;
		}
		return result;
	}
}

function defaultCredentialProperties(
	configs: Pick<WorkspaceConfiguration, "get">,
): { keyringEnabled: boolean; category: CredentialCategory } {
	const keyringEnabled = isKeyringEnabled(configs);
	return {
		keyringEnabled,
		category: keyringEnabled ? "keyring" : "file",
	};
}

function createCredentialTrace(span: Span): CredentialTrace {
	const run = async <T>(
		category: CredentialCategory,
		fn: () => Promise<T>,
	): Promise<T> => {
		span.setProperty("category", category);
		return await fn();
	};
	return {
		file: (fn) => run("file", fn),
		keyring: (fn) => run("keyring", fn),
	};
}

function recordCredentialFailure(
	span: Span,
	category: CredentialCategory,
	error: unknown,
): void {
	span.setProperty("category", category);
	span.setProperty("failure_category", categorizeCredentialError(error));
}

function recordClearFailure(span: Span, result: CredentialClearResult): void {
	if (!result.failureCategory) {
		return;
	}

	span.setProperty("failure_category", result.failureCategory);
	if (result.failureCategory === "aborted") {
		span.markAborted();
		return;
	}
	span.markFailure();
}

export function categorizeCredentialError(
	error: unknown,
): CredentialFailureCategory {
	if (isAbortError(error)) {
		return "aborted";
	}
	if (error instanceof CredentialFileError) {
		return "file";
	}
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

export class CredentialFileError extends Error {
	public constructor(cause: unknown) {
		super("Credential file operation failed", { cause });
		this.name = "CredentialFileError";
	}
}
