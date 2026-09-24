import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceUpdateForm } from "@repo/workspace-update/components/WorkspaceUpdateForm";

import { renderWithQuery } from "../render";

import type {
	DynamicParametersResponse,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

const { mockApi } = vi.hoisted(() => ({
	mockApi: { evaluate: vi.fn(), submit: vi.fn(), cancel: vi.fn() },
}));

vi.mock("@repo/workspace-update/hooks/useWorkspaceUpdateApi", () => ({
	useWorkspaceUpdateApi: () => mockApi,
}));

vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: vi.fn(),
	getState: () => undefined,
	setState: vi.fn(),
}));

function parameter(overrides: Partial<PreviewParameter>): PreviewParameter {
	return {
		name: "region",
		display_name: "Region",
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

function evaluatesTo(
	parameters: PreviewParameter[],
	diagnostics: DynamicParametersResponse["diagnostics"] = [],
) {
	mockApi.evaluate.mockResolvedValue({ id: 0, parameters, diagnostics });
}

function renderForm(values: Record<string, string> = { region: "eu" }) {
	return renderWithQuery(
		<WorkspaceUpdateForm
			init={{ workspaceName: "me/dev", values, restart: true }}
		/>,
	);
}

const updateButton = () =>
	screen.getByRole("button", { name: "Update and restart" });

describe("WorkspaceUpdateForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("submits mutable values, using the server's value for untouched ones", async () => {
		evaluatesTo([
			parameter({ name: "region" }),
			parameter({
				name: "size",
				display_name: "Size",
				value: { valid: true, value: "large" },
			}),
			parameter({ name: "image", display_name: "Image", mutable: false }),
		]);
		renderForm();

		expect(await screen.findByRole("textbox", { name: "Region" })).toHaveValue(
			"eu",
		);
		await waitFor(() => expect(updateButton()).toBeEnabled());
		fireEvent.click(updateButton());

		expect(mockApi.submit).toHaveBeenCalledWith({
			region: "eu",
			size: "large",
		});
	});

	it("re-evaluates edits before allowing submit", async () => {
		evaluatesTo([parameter({ name: "region" })]);
		renderForm();

		fireEvent.change(await screen.findByRole("textbox", { name: "Region" }), {
			target: { value: "us" },
		});

		expect(updateButton()).toBeDisabled();
		await waitFor(() =>
			expect(mockApi.evaluate).toHaveBeenLastCalledWith({ region: "us" }),
		);
		await waitFor(() => expect(updateButton()).toBeEnabled());
	});

	it("blocks submit and shows errors from the evaluator", async () => {
		evaluatesTo(
			[
				parameter({
					name: "region",
					diagnostics: [
						{
							severity: "error",
							summary: "Unknown region",
							detail: "",
							extra: { code: "" },
						},
					],
				}),
			],
			[
				{
					severity: "error",
					summary: "Template failed",
					detail: "",
					extra: { code: "" },
				},
			],
		);
		renderForm();

		expect(await screen.findByText("Unknown region")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("Template failed");
		expect(screen.getByRole("textbox", { name: "Region" })).toBeInvalid();
		expect(updateButton()).toBeDisabled();
	});

	it("locks immutable parameters and blocks the update when they are invalid", async () => {
		evaluatesTo([
			parameter({
				name: "region",
				mutable: false,
				diagnostics: [
					{
						severity: "error",
						summary: "No longer allowed",
						detail: "",
						extra: { code: "" },
					},
				],
			}),
		]);
		renderForm();

		expect(
			await screen.findByRole("textbox", { name: /^Region/ }),
		).toBeDisabled();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Workspace update blocked",
		);
	});

	it("sorts parameters by their order", async () => {
		evaluatesTo([
			parameter({ name: "b", display_name: "B", order: 2 }),
			parameter({ name: "a", display_name: "A", order: 1 }),
		]);
		renderForm({});

		await screen.findByRole("textbox", { name: "A" });
		const [first] = screen.getAllByRole("textbox");
		expect(first).toHaveAccessibleName("A");
	});

	it("cancels the update", async () => {
		evaluatesTo([]);
		renderForm();

		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(mockApi.cancel).toHaveBeenCalled();
	});
});
