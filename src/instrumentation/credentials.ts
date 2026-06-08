import { isAbortError } from "../error/errorUtils";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryReporter } from "../telemetry/reporter";

export type CredentialCategory = "keyring" | "file";
export type CredentialFailureCategory = "aborted" | "binary" | "cli" | "file";

export interface CredentialStoreResult {
	readonly category: CredentialCategory;
}

export interface CredentialClearResult {
	readonly category: CredentialCategory;
	readonly failureCategory?: CredentialFailureCategory;
}

export class CredentialTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public async traceStore<T extends CredentialStoreResult>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: () => Promise<T>,
	): Promise<T> {
		const keyringEnabled = isKeyringEnabled(configs);
		const defaultCategory: CredentialCategory = keyringEnabled
			? "keyring"
			: "file";
		let cancellation: unknown;
		const result = await this.telemetry.trace(
			"auth.credential_stored",
			async (span) => {
				try {
					const result = await fn();
					span.setProperty("category", result.category);
					return result;
				} catch (error) {
					span.setProperty("category", defaultCategory);
					span.setProperty("failureCategory", categorizeCredentialError(error));
					if (isAbortError(error)) {
						span.markAborted();
						cancellation = error;
						return { category: defaultCategory } as T;
					}
					throw error;
				}
			},
			{ keyringEnabled, category: defaultCategory },
		);
		if (cancellation instanceof Error) {
			throw cancellation;
		}
		return result;
	}

	public async traceClear<T extends CredentialClearResult>(
		configs: Pick<WorkspaceConfiguration, "get">,
		fn: () => Promise<T>,
	): Promise<T> {
		const keyringEnabled = isKeyringEnabled(configs);
		const defaultCategory: CredentialCategory = keyringEnabled
			? "keyring"
			: "file";
		let cancellation: unknown;
		const result = await this.telemetry.trace(
			"auth.credential_cleared",
			async (span) => {
				try {
					const result = await fn();
					span.setProperty("category", result.category);
					if (result.failureCategory) {
						span.setProperty("failureCategory", result.failureCategory);
						if (result.failureCategory === "aborted") {
							span.markAborted();
						} else {
							span.markFailure();
						}
					}
					return result;
				} catch (error) {
					span.setProperty("category", defaultCategory);
					span.setProperty("failureCategory", categorizeCredentialError(error));
					if (isAbortError(error)) {
						span.markAborted();
						cancellation = error;
						return {
							category: defaultCategory,
							failureCategory: "aborted",
						} as T;
					}
					throw error;
				}
			},
			{ keyringEnabled, category: defaultCategory },
		);
		if (cancellation instanceof Error) {
			throw cancellation;
		}
		return result;
	}
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
