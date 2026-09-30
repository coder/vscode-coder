import { defineCommand, defineRequest } from "../ipc/protocol";

import type { DynamicParametersResponse } from "coder/site/src/api/typesGenerated";

export type ParameterValues = Readonly<Record<string, string>>;

export interface WorkspaceUpdateInit {
	readonly workspaceName: string;
	/** Omitted parameters use the server's value. */
	readonly values: ParameterValues;
	/** The server's evaluation of `values`. */
	readonly evaluation: DynamicParametersResponse;
	readonly restart: boolean;
}

export const WorkspaceUpdateApi = {
	init: defineRequest<void, WorkspaceUpdateInit>("workspaceUpdate/init"),
	evaluate: defineRequest<ParameterValues, DynamicParametersResponse>(
		"workspaceUpdate/evaluate",
	),
	submit: defineCommand<ParameterValues>("workspaceUpdate/submit"),
	cancel: defineCommand<void>("workspaceUpdate/cancel"),
} as const;

export function hasErrorDiagnostics({
	parameters,
	diagnostics,
}: DynamicParametersResponse): boolean {
	return [...diagnostics, ...parameters.flatMap((p) => p.diagnostics)].some(
		(d) => d.severity === "error",
	);
}

/** Multi-select values are stored as a JSON-encoded string array. */
export function parseMultiSelectValue(raw: string): string[] | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
			? parsed
			: null;
	} catch {
		return null;
	}
}
