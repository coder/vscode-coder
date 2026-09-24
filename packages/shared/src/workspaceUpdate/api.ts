import { defineCommand, defineRequest } from "../ipc/protocol";

import type { DynamicParametersResponse } from "coder/site/src/api/typesGenerated";

export type ParameterValues = Readonly<Record<string, string>>;

export interface WorkspaceUpdateInit {
	readonly workspaceName: string;
	/** Missing values follow the server. */
	readonly values: ParameterValues;
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
}: Pick<DynamicParametersResponse, "parameters" | "diagnostics">): boolean {
	return [...diagnostics, ...parameters.flatMap((p) => p.diagnostics)].some(
		(d) => d.severity === "error",
	);
}
