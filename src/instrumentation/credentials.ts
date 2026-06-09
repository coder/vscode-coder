import { isAbortError } from "../error/errorUtils";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type CredentialCategory = "keyring" | "file";
export type CredentialFailureCategory = "aborted" | "binary" | "cli" | "file";

export interface CredentialStoreRecorder {
	setCategory(category: CredentialCategory): void;
}

export interface CredentialClearRecorder {
	setCategory(category: CredentialCategory): void;
}

export interface CredentialClearResult {
	readonly failureCategory?: CredentialFailureCategory;
}

export class CredentialTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public async traceStore<T>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (recorder: CredentialStoreRecorder) => Promise<T>,
	): Promise<T> {
		const defaults = defaultCredentialProperties(configs);
		let cancellation: unknown;
		const result = await this.telemetry.trace(
			"auth.credential.store",
			async (span) => {
				try {
					return await fn(createCredentialRecorder(span));
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

	public async traceClear<T extends CredentialClearResult>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: (recorder: CredentialClearRecorder) => Promise<T>,
	): Promise<T> {
		const defaults = defaultCredentialProperties(configs);
		let cancellation: unknown;
		const result = await this.telemetry.trace(
			"auth.credential.clear",
			async (span) => {
				try {
					const result = await fn(createCredentialRecorder(span));
					recordClearFailure(span, result.failureCategory);
					return result;
				} catch (error) {
					recordCredentialFailure(span, defaults.category, error);
					if (isAbortError(error)) {
						span.markAborted();
						cancellation = error;
						return { failureCategory: "aborted" } as T;
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

function createCredentialRecorder(
	span: Span,
): CredentialStoreRecorder & CredentialClearRecorder {
	return {
		setCategory: (category) => span.setProperty("category", category),
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

function recordClearFailure(
	span: Span,
	failureCategory: CredentialClearResult["failureCategory"],
): void {
	if (!failureCategory) {
		return;
	}

	span.setProperty("failure_category", failureCategory);
	if (failureCategory === "aborted") {
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
