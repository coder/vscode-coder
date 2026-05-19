import * as vscode from "vscode";

import type { Api } from "coder/site/src/api/api";
import type {
	TemplateVersionParameter,
	Workspace,
} from "coder/site/src/api/typesGenerated";

/** Thrown when the user dismisses a parameter prompt. */
export class WorkspaceUpdateCancelledError extends Error {
	constructor() {
		super("Workspace update cancelled");
		this.name = "WorkspaceUpdateCancelledError";
	}
}

/**
 * Prompts the user for any newly-required template parameters and returns
 * `--parameter name=value` args suitable for `coder update`. Throws
 * `WorkspaceUpdateCancelledError` if the user dismisses a prompt.
 */
export async function collectUpdateParameters(
	restClient: Api,
	workspace: Workspace,
): Promise<string[]> {
	const [newParams, currentValues] = await Promise.all([
		restClient.getTemplateVersionRichParameters(
			workspace.template_active_version_id,
		),
		restClient.getWorkspaceBuildParameters(workspace.latest_build.id),
	]);
	const candidates = newParams.filter((p) => p.required && !p.default_value);
	if (candidates.length === 0) return [];

	const existing = new Set(currentValues.map((p) => p.name));
	const toPrompt = candidates.filter((p) => !existing.has(p.name));

	const args: string[] = [];
	for (let i = 0; i < toPrompt.length; i++) {
		const param = toPrompt[i];
		const value = await promptForParameter(param, i + 1, toPrompt.length);
		if (value === undefined) {
			throw new WorkspaceUpdateCancelledError();
		}
		args.push("--parameter", `${param.name}=${value}`);
	}
	return args;
}

function promptForParameter(
	param: TemplateVersionParameter,
	step: number,
	totalSteps: number,
): Promise<string | undefined> {
	const title = param.display_name || param.name;
	const items = quickPickItems(param);

	if (items) {
		const multi = param.form_type === "multi-select";
		const qp = vscode.window.createQuickPick<(typeof items)[number]>();
		qp.title = title;
		qp.step = step;
		qp.totalSteps = totalSteps;
		qp.placeholder = param.description_plaintext;
		qp.items = items;
		qp.canSelectMany = multi;
		qp.ignoreFocusOut = true;
		return collectInput(qp, () => {
			if (multi) {
				return qp.selectedItems.length > 0
					? JSON.stringify(qp.selectedItems.map((i) => i.value))
					: undefined;
			}
			return qp.selectedItems[0]?.value;
		});
	}

	const input = vscode.window.createInputBox();
	input.title = title;
	input.step = step;
	input.totalSteps = totalSteps;
	input.prompt = param.description_plaintext;
	input.placeholder = formatConstraint(param);
	input.value = param.default_value;
	input.ignoreFocusOut = true;
	const validate = makeValidator(param);
	const refresh = () => {
		input.validationMessage = validate(input.value).message ?? "";
	};
	refresh();
	input.onDidChangeValue(refresh);
	return collectInput(input, () =>
		validate(input.value).ok ? input.value : undefined,
	);
}

/** Resolves with `onAccept()` on accept, or `undefined` when hidden. */
function collectInput<T>(
	qi: vscode.InputBox | vscode.QuickPick<vscode.QuickPickItem>,
	onAccept: () => T | undefined,
): Promise<T | undefined> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: T | undefined) => {
			if (done) return;
			done = true;
			resolve(value);
			qi.dispose();
		};
		qi.onDidAccept(() => {
			const value = onAccept();
			if (value !== undefined) finish(value);
		});
		qi.onDidHide(() => finish(undefined));
		qi.show();
	});
}

/**
 * Returns picker items if the param needs a chooser, otherwise undefined.
 * Anything that falls through gets a free-form text input.
 */
function quickPickItems(
	param: TemplateVersionParameter,
): Array<vscode.QuickPickItem & { value: string }> | undefined {
	if (param.type === "bool") {
		return [
			{ label: "True", value: "true" },
			{ label: "False", value: "false" },
		];
	}
	if (param.options.length > 0) {
		return param.options.map((o) => ({
			label: o.name,
			description: o.description,
			value: o.value,
		}));
	}
	return undefined;
}

function isSet<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined;
}

function formatConstraint(param: TemplateVersionParameter): string {
	if (param.type === "number") {
		const lo = param.validation_min;
		const hi = param.validation_max;
		if (isSet(lo) && isSet(hi)) return `between ${lo} and ${hi}`;
		if (isSet(lo)) return `at least ${lo}`;
		if (isSet(hi)) return `at most ${hi}`;
		return "a number";
	}
	if (param.validation_regex) {
		return (
			substituteTemplate(param.validation_error, param) ||
			`must match ${param.validation_regex}`
		);
	}
	return "";
}

/** Substitutes `{min}`, `{max}`, `{value}` placeholders in validation_error. */
function substituteTemplate(
	template: string | undefined,
	param: TemplateVersionParameter,
	value?: string,
): string | undefined {
	if (!template) return template;
	return template
		.replace(/{min}/g, String(param.validation_min ?? ""))
		.replace(/{max}/g, String(param.validation_max ?? ""))
		.replace(/{value}/g, value ?? "");
}

/**
 * Returns `{ ok, message }`. Regex constraints are intentionally not tested
 * client-side; server validates with RE2 (linear-time, ReDoS-safe).
 */
function makeValidator(
	param: TemplateVersionParameter,
): (input: string) => { ok: boolean; message?: string } {
	return (input) => {
		if (!input) return { ok: !param.required };
		if (param.type === "number") {
			const n = Number(input);
			if (!Number.isFinite(n)) {
				return { ok: false, message: "Must be a number" };
			}
			if (isSet(param.validation_min) && n < param.validation_min) {
				return {
					ok: false,
					message:
						substituteTemplate(param.validation_error, param, input) ||
						`Must be at least ${param.validation_min}`,
				};
			}
			if (isSet(param.validation_max) && n > param.validation_max) {
				return {
					ok: false,
					message:
						substituteTemplate(param.validation_error, param, input) ||
						`Must be at most ${param.validation_max}`,
				};
			}
		}
		return { ok: true };
	};
}
