import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	parseTagSelectValue,
	WorkspaceUpdateForm,
} from "../../../packages/workspace-update/src/components/WorkspaceUpdateForm";

import type { WorkspaceUpdateState } from "@repo/shared";
function parameter(
	name: string,
	form_type: WorkspaceUpdateState["parameters"][number]["form_type"],
	options: ReadonlyArray<{
		name: string;
		value: string;
	}> = [],
): WorkspaceUpdateState["parameters"][number] {
	return {
		name,
		display_name: name,
		description: `${name} description`,
		type: form_type === "slider" ? "number" : "string",
		form_type,
		styling: {},
		mutable: true,
		default_value: { valid: false, value: "" },
		value: { valid: false, value: "" },
		icon: "",
		options: options.map((option) => ({
			...option,
			description: "",
			value: { valid: true, value: option.value },
			icon: "",
		})),
		validations: [],
		required: false,
		order: 0,
		ephemeral: false,
		diagnostics: [],
	};
}
function state(
	overrides: Partial<WorkspaceUpdateState> = {},
): WorkspaceUpdateState {
	return {
		workspaceName: "dev",
		templateVersionId: "version-1",
		revision: 4,
		status: "ready",
		parameters: [parameter("region", "input")],
		inputs: { region: "east" },
		locked: [],
		diagnostics: [],
		canSubmit: true,
		...overrides,
	};
}
function renderForm(current = state()) {
	const onChange = vi.fn();
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	const onRetry = vi.fn();
	const view = render(
		createElement(WorkspaceUpdateForm, {
			state: current,
			onChange: onChange,
			onSubmit: onSubmit,
			onCancel: onCancel,
			onRetry: onRetry,
		}),
	);
	return { ...view, onChange, onSubmit, onCancel, onRetry };
}
describe("WorkspaceUpdateForm", () => {
	it("keeps a local draft until the extension reflects it and submits the reflected revision", () => {
		const initial = state();
		const { onChange, onSubmit, rerender } = renderForm(initial);
		const input = screen.getByRole("textbox", { name: "region" });
		fireEvent.change(input, { target: { value: "west" } });
		expect(input).toHaveValue("west");
		expect(onChange).toHaveBeenCalledWith({ name: "region", value: "west" });
		expect(
			screen.getByRole("button", { name: "Update and Restart" }),
		).toBeDisabled();
		rerender(
			createElement(WorkspaceUpdateForm, {
				state: { ...initial, revision: 5, inputs: { region: "west" } },
				onChange: onChange,
				onSubmit: onSubmit,
				onCancel: vi.fn(),
				onRetry: vi.fn(),
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
		expect(onSubmit).toHaveBeenCalledWith(5);
	});
	it("does not overwrite a newer local draft with a stale extension notification", () => {
		const { onChange, rerender } = renderForm();
		const input = screen.getByRole("textbox", { name: "region" });
		fireEvent.change(input, { target: { value: "west" } });
		rerender(
			createElement(WorkspaceUpdateForm, {
				state: state({
					revision: 5,
					inputs: { region: "east" },
					status: "evaluating",
				}),
				onChange: onChange,
				onSubmit: vi.fn(),
				onCancel: vi.fn(),
				onRetry: vi.fn(),
			}),
		);
		expect(screen.getByRole("textbox", { name: "region" })).toHaveValue("west");
	});
	it("maps radios to Select, switches to Checkbox, sliders to number input, and multi-select to checkboxes", () => {
		renderForm(
			state({
				inputs: {
					region: "east",
					enabled: "true",
					cores: "2",
					features: '["metrics"]',
				},
				parameters: [
					parameter("region", "radio", [
						{ name: "East", value: "east" },
						{ name: "West", value: "west" },
					]),
					parameter("enabled", "switch"),
					parameter("cores", "slider"),
					parameter("features", "multi-select", [
						{ name: "Metrics", value: "metrics" },
						{ name: "Tracing", value: "tracing" },
					]),
				],
			}),
		);
		expect(
			screen.getByRole("combobox", { name: "region" }),
		).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: "enabled" })).toBeChecked();
		expect(screen.getByRole("spinbutton", { name: "cores" })).toHaveValue(2);
		expect(screen.getByRole("checkbox", { name: /Metrics/ })).toBeChecked();
		expect(screen.getByRole("checkbox", { name: /Tracing/ })).not.toBeChecked();
	});
	it("uses a password input for masked values and disables locked fields", () => {
		renderForm(
			state({
				inputs: { token: "secret", frozen: "value" },
				locked: ["frozen"],
				parameters: [
					{ ...parameter("token", "input"), styling: { mask_input: true } },
					parameter("frozen", "input"),
				],
			}),
		);
		expect(screen.getByLabelText("token")).toHaveAttribute("type", "password");
		expect(screen.getByRole("textbox", { name: "frozen" })).toBeDisabled();
	});
	it("renders server diagnostics as safe text and preserves tag-select values as JSON", () => {
		renderForm(
			state({
				inputs: { tags: '["team,blue"]' },
				parameters: [
					{
						...parameter("tags", "tag-select"),
						description: "<strong>Do not render HTML</strong>",
						diagnostics: [
							{
								severity: "error",
								summary: "Tags are invalid",
								detail: "",
								extra: { code: "invalid" },
							},
						],
					},
				],
			}),
		);
		expect(screen.getByText("Tags are invalid")).toBeInTheDocument();
		expect(
			screen.getByText(/<strong>Do not render HTML<\/strong>/),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Do not render HTML", { selector: "strong" }),
		).toBeNull();
		expect(screen.getByRole("textbox", { name: "tags" })).toHaveValue(
			'["team,blue"]',
		);
	});
	it("renders terminal success without actions", () => {
		renderForm(state({ status: "success" }));
		expect(
			screen.getByRole("heading", { name: "Workspace updated" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
describe("parseTagSelectValue", () => {
	it("accepts arbitrary strings including commas and rejects lossy input", () => {
		expect(parseTagSelectValue('["team,blue", "prod"]')).toEqual([
			"team,blue",
			"prod",
		]);
		expect(parseTagSelectValue("team,blue,prod")).toBeUndefined();
	});
});

describe("dynamic form review regressions", () => {
	it("allows a new immutable value while keeping existing immutable values locked", () => {
		renderForm(
			state({
				parameters: [
					{ ...parameter("existing", "input"), mutable: false },
					{
						...parameter("introduced", "input"),
						mutable: false,
						required: true,
					},
				],
				locked: ["existing"],
				inputs: { existing: "saved", introduced: "" },
			}),
		);
		expect(screen.getByRole("textbox", { name: "existing" })).toBeDisabled();
		expect(
			screen.getByRole("textbox", { name: "introduced (required)" }),
		).toBeEnabled();
	});

	it("rejects invalid tag arrays even when the previous server state was valid", () => {
		renderForm(
			state({
				parameters: [parameter("tags", "tag-select")],
				inputs: { tags: "not an array" },
			}),
		);
		expect(
			screen.getByRole("button", { name: "Update and Restart" }),
		).toBeDisabled();
	});

	it("provides retry after evaluation errors but not ambiguous build errors", () => {
		const { rerender } = renderForm(
			state({ status: "error", error: "Network error", canRetry: true }),
		);
		expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
		rerender(
			createElement(WorkspaceUpdateForm, {
				state: state({
					status: "error",
					error: "Check build status",
					canRetry: false,
				}),
				onChange: vi.fn(),
				onCancel: vi.fn(),
				onRetry: vi.fn(),
				onSubmit: vi.fn(),
			}),
		);
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		expect(screen.getByRole("textbox", { name: "region" })).toBeDisabled();
	});
});
