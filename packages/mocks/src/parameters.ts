/**
 * Test factories for dynamic template parameter types.
 */

import type {
	FriendlyDiagnostic,
	PreviewParameter,
	PreviewParameterOption,
} from "coder/site/src/api/typesGenerated";

/** Create a mutable, optional string PreviewParameter with no diagnostics. */
export function previewParameter(
	overrides: Partial<PreviewParameter> = {},
): PreviewParameter {
	return {
		name: "region",
		display_name: "",
		description: "",
		type: "string",
		form_type: "input",
		styling: {},
		mutable: true,
		default_value: { valid: true, value: "" },
		value: { valid: true, value: "" },
		icon: "",
		options: [],
		validations: [],
		required: false,
		order: 0,
		ephemeral: false,
		diagnostics: [],
		...overrides,
	};
}

/** Create a PreviewParameterOption whose name defaults to its value. */
export function parameterOption(
	value: string,
	name = value,
	description = "",
): PreviewParameterOption {
	return { name, description, value: { valid: true, value }, icon: "" };
}

/** Create a FriendlyDiagnostic, an error unless `severity` says otherwise. */
export function diagnostic(
	summary: string,
	severity: FriendlyDiagnostic["severity"] = "error",
): FriendlyDiagnostic {
	return { severity, summary, detail: "", extra: { code: "" } };
}
