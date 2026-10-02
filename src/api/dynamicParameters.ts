import { isApiError } from "coder/site/src/api/errors";

import {
	hasErrorDiagnostics,
	parseMultiSelectValue,
	type ParameterValues,
	type WorkspaceUpdateInit,
} from "@repo/shared";

import type { Api } from "coder/site/src/api/api";
import type {
	DynamicParametersResponse,
	FriendlyDiagnostic,
	PreviewParameter,
	ValidationError,
	Workspace,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

export type EvaluateParameters = (
	inputs: ParameterValues,
) => Promise<DynamicParametersResponse>;

/** Shows the parameter form and resolves with the submitted values. */
export type ShowUpdateForm = (
	init: WorkspaceUpdateInit,
	evaluate: EvaluateParameters,
) => Promise<WorkspaceBuildParameter[]>;

/**
 * Keeps the previous values when the new version accepts them, otherwise
 * asks through the form, like the dashboard.
 */
export async function collectDynamicParameters(
	restClient: Api,
	workspace: Workspace,
	showForm: ShowUpdateForm,
): Promise<WorkspaceBuildParameter[]> {
	const evaluate = evaluator(restClient, workspace);
	const previous = await previousValues(restClient, workspace);
	const evaluation = await evaluate(previous);
	if (!hasErrorDiagnostics(evaluation)) {
		return [];
	}
	const values = acceptedValues(evaluation.parameters, previous);
	return showForm(
		formInit(workspace, values, await evaluate(values)),
		evaluate,
	);
}

/** Reopens the form on values the build rejected, with the server's reasons. */
export async function reviseRejectedParameters(
	restClient: Api,
	workspace: Workspace,
	rejected: readonly WorkspaceBuildParameter[],
	validations: readonly ValidationError[],
	showForm: ShowUpdateForm,
): Promise<WorkspaceBuildParameter[]> {
	const evaluate = evaluator(restClient, workspace);
	const values = {
		...(await previousValues(restClient, workspace)),
		...Object.fromEntries(rejected.map(({ name, value }) => [name, value])),
	};
	const evaluation = await evaluate(values);
	const rejections = validations.map(
		({ field, detail }): FriendlyDiagnostic => ({
			severity: "error",
			summary: `${field}: ${detail}`,
			detail: "",
			extra: { code: "" },
		}),
	);
	return showForm(
		formInit(workspace, values, {
			...evaluation,
			diagnostics: [...evaluation.diagnostics, ...rejections],
		}),
		evaluate,
	);
}

/** The field errors of a build the server rejected for its parameters. */
export function rejectedParameters(
	error: unknown,
): readonly ValidationError[] | undefined {
	if (!isApiError(error) || error.response.status !== 400) {
		return undefined;
	}
	const { validations } = error.response.data;
	return validations?.length ? validations : undefined;
}

function evaluator(restClient: Api, workspace: Workspace): EvaluateParameters {
	const { template_active_version_id: versionId, owner_id } = workspace;
	return async (inputs) => {
		const response = await restClient.getTemplateVersionDynamicParameters(
			versionId,
			{ id: 0, owner_id, inputs },
		);
		// The server sends null for empty lists.
		return {
			...response,
			parameters: response.parameters ?? [],
			diagnostics: response.diagnostics ?? [],
		};
	};
}

async function previousValues(
	restClient: Api,
	workspace: Workspace,
): Promise<ParameterValues> {
	const parameters = await restClient.getWorkspaceBuildParameters(
		workspace.latest_build.id,
	);
	return Object.fromEntries(parameters.map(({ name, value }) => [name, value]));
}

function formInit(
	workspace: Workspace,
	values: ParameterValues,
	evaluation: DynamicParametersResponse,
): WorkspaceUpdateInit {
	return {
		workspaceName: `${workspace.owner_name}/${workspace.name}`,
		values,
		evaluation,
		restart: workspace.latest_build.status === "running",
	};
}

/** Like the dashboard's `getInitialParameterValues`. */
function acceptedValues(
	parameters: readonly PreviewParameter[],
	previous: ParameterValues,
): ParameterValues {
	const accepted: Record<string, string> = {};
	for (const parameter of parameters) {
		const value = previous[parameter.name];
		if (value === undefined || parameter.ephemeral) {
			continue;
		}
		if (isValidOption(parameter, value)) {
			accepted[parameter.name] = value;
		}
	}
	return accepted;
}

function isValidOption(parameter: PreviewParameter, value: string): boolean {
	if (parameter.options.length === 0) {
		return true;
	}
	const options = new Set(parameter.options.map((o) => o.value.value));
	if (parameter.form_type !== "multi-select") {
		return options.has(value);
	}
	return (
		parseMultiSelectValue(value)?.some((selected) => options.has(selected)) ??
		false
	);
}
