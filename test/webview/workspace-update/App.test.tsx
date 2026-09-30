import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { diagnostic, previewParameter } from "@repo/mocks";
import App from "@repo/workspace-update/App";

import { renderWithQuery } from "../render";

import type {
	FriendlyDiagnostic,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

import type { ParameterValues } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {
		init: vi.fn(),
		evaluate: vi.fn(),
		submit: vi.fn(),
		cancel: vi.fn(),
	},
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
	return previewParameter({ display_name: "Region", ...overrides });
}

interface RenderOptions {
	diagnostics?: FriendlyDiagnostic[];
	values?: ParameterValues;
}

function renderApp(
	parameters: PreviewParameter[],
	{ diagnostics = [], values = { region: "eu" } }: RenderOptions = {},
) {
	const evaluation = { id: 0, parameters, diagnostics };
	mockApi.init.mockResolvedValue({
		workspaceName: "me/dev",
		values,
		evaluation,
		restart: true,
	});
	mockApi.evaluate.mockResolvedValue(evaluation);
	return renderWithQuery(<App />);
}

const updateButton = () =>
	screen.getByRole("button", { name: "Update and restart" });

describe("workspace update webview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("submits mutable values, using the server's value for untouched ones", async () => {
		renderApp([
			parameter({ name: "region" }),
			parameter({
				name: "size",
				display_name: "Size",
				value: { valid: true, value: "large" },
			}),
			parameter({ name: "image", display_name: "Image", mutable: false }),
		]);

		expect(await screen.findByRole("textbox", { name: "Region" })).toHaveValue(
			"eu",
		);
		await waitFor(() => expect(updateButton()).toBeEnabled());
		fireEvent.click(updateButton());

		expect(mockApi.evaluate).not.toHaveBeenCalled();
		expect(mockApi.submit).toHaveBeenCalledWith({
			region: "eu",
			size: "large",
		});
	});

	it("re-evaluates edits before allowing submit", async () => {
		renderApp([parameter({ name: "region" })]);

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
		renderApp(
			[
				parameter({
					name: "region",
					diagnostics: [diagnostic("Unknown region")],
				}),
			],
			{ diagnostics: [diagnostic("Template failed")] },
		);

		expect(await screen.findByText("Unknown region")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("Template failed");
		expect(screen.getByRole("textbox", { name: "Region" })).toBeInvalid();
		expect(updateButton()).toBeDisabled();
	});

	it("locks immutable parameters and blocks the update when they are invalid", async () => {
		renderApp([
			parameter({
				name: "region",
				mutable: false,
				diagnostics: [diagnostic("No longer allowed")],
			}),
		]);

		expect(
			await screen.findByRole("textbox", { name: /^Region/ }),
		).toBeDisabled();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Workspace update blocked",
		);
	});

	it("sorts parameters by their order", async () => {
		renderApp(
			[
				parameter({ name: "b", display_name: "B", order: 2 }),
				parameter({ name: "a", display_name: "A", order: 1 }),
			],
			{ values: {} },
		);

		await screen.findByRole("textbox", { name: "A" });
		const [first] = screen.getAllByRole("textbox");
		expect(first).toHaveAccessibleName("A");
	});

	it("cancels the update", async () => {
		renderApp([]);

		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(mockApi.cancel).toHaveBeenCalled();
	});
});
