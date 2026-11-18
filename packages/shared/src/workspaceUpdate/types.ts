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
