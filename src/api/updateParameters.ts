import * as vscode from "vscode";

import type { Api } from "coder/site/src/api/api";
import type {
	TemplateVersionParameter,
	Workspace,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

const MAX_VALUE_LEN = 60;
const MAX_LIST_ITEMS = 5;

interface PromptSpec {
	/** Drift note prepended to the parameter's description in the prompt placeholder. */
	driftNote?: string;
	/** Surviving picks to pre-check on a multi-select drift re-prompt. */
	preselect?: string[];
}

/** Thrown when the user dismisses a parameter prompt. */
export class WorkspaceUpdateCancelledError extends Error {
	constructor() {
		super("Workspace update cancelled");
		this.name = "WorkspaceUpdateCancelledError";
	}
}

/**
 * Prompts the user for any template parameters that the new version needs
 * answered, and returns the collected `{ name, value }` pairs. Throws
 * `WorkspaceUpdateCancelledError` if the user dismisses a prompt.
 */
export async function collectUpdateParameters(
	restClient: Api,
	workspace: Workspace,
): Promise<WorkspaceBuildParameter[]> {
	const [newParams, currentValues] = await Promise.all([
		restClient.getTemplateVersionRichParameters(
			workspace.template_active_version_id,
		),
		restClient.getWorkspaceBuildParameters(workspace.latest_build.id),
	]);
	const stored = new Map(currentValues.map((p) => [p.name, p.value]));
	const toPrompt = newParams.flatMap((param) => {
		const spec = promptSpec(param, stored.get(param.name));
		return spec ? [{ param, spec }] : [];
	});

	const collected: WorkspaceBuildParameter[] = [];
	for (let i = 0; i < toPrompt.length; i++) {
		const { param, spec } = toPrompt[i];
		const value = await promptForParameter(param, spec, i + 1, toPrompt.length);
		if (value === undefined) {
			throw new WorkspaceUpdateCancelledError();
		}
		collected.push({ name: param.name, value });
	}
	return collected;
}

/**
 * Returns a `PromptSpec` if the parameter needs a fresh answer, else `undefined`.
 *
 * Based on the dashboard's `getMissingParameters` (coder/site/src/api/api.ts),
 * which is the legacy-params check. Dynamic-parameter templates rely on
 * server-side validation via the `/dynamic-parameters` WebSocket.
 */
function promptSpec(
	param: TemplateVersionParameter,
	storedValue: string | undefined,
): PromptSpec | undefined {
	if (storedValue === undefined) {
		// Immutable: prompt before the default is locked in for good.
		if (!param.mutable) return {};
		// `required` is false whenever a default exists (TF provider sets
		// `optional=true`), so no separate default_value check is needed.
		return param.required ? {} : undefined;
	}
	if (param.options.length === 0) return undefined;
	const valid = new Set(param.options.map((o) => o.value));
	if (param.form_type === "multi-select") {
		// Beyond dashboard: detect multi-select drift too.
		const picks = parseMultiSelectValue(storedValue);
		if (picks === null) {
			return {
				driftNote: "No previous selections recovered.",
				preselect: [],
			};
		}
		const drifted = picks.filter((v) => !valid.has(v));
		if (drifted.length === 0) return undefined;
		return {
			driftNote: `Previous selections no longer available: ${formatDriftList(drifted)}.`,
			preselect: picks.filter((v) => valid.has(v)),
		};
	}
	if (valid.has(storedValue)) return undefined;
	const driftNote =
		storedValue === ""
			? "No previous value was set."
			: `Previous value ${formatValue(storedValue)} is no longer available.`;
	return { driftNote };
}

/** Multi-select values are stored as a JSON-encoded string array. */
function parseMultiSelectValue(raw: string): string[] | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
			? parsed
			: null;
	} catch {
		return null;
	}
}

/** Truncates and JSON-quotes a value for safe display in a placeholder. */
function formatValue(value: string): string {
	const truncated =
		value.length > MAX_VALUE_LEN
			? `${value.slice(0, MAX_VALUE_LEN)}...`
			: value;
	return JSON.stringify(truncated);
}

/** Joins drifted values with per-item and list-length caps. */
function formatDriftList(values: string[]): string {
	const head = values.slice(0, MAX_LIST_ITEMS).map(formatValue).join(", ");
	const extra = values.length - MAX_LIST_ITEMS;
	return extra > 0 ? `${head}, +${extra} more` : head;
}

function promptForParameter(
	param: TemplateVersionParameter,
	spec: PromptSpec,
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
		qp.placeholder = [spec.driftNote, param.description_plaintext]
			.filter((s) => s)
			.join(" ");
		qp.items = items;
		qp.canSelectMany = multi;
		qp.ignoreFocusOut = true;
		const { preselect } = spec;
		if (multi && preselect) {
			qp.selectedItems = items.filter((item) => preselect.includes(item.value));
		}
		return collectInput(qp, () => {
			if (multi) {
				if (qp.selectedItems.length === 0) {
					return param.required ? undefined : "[]";
				}
				return JSON.stringify(qp.selectedItems.map((i) => i.value));
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
