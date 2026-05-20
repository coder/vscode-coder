import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "@/api/updateParameters";

import { workspace as createWorkspace } from "@repo/mocks";

import type { Api } from "coder/site/src/api/api";
import type { TemplateVersionParameter } from "coder/site/src/api/typesGenerated";

function param(overrides: Partial<TemplateVersionParameter> = {}) {
	return {
		name: "environment",
		display_name: "Environment",
		description: "",
		description_plaintext: "",
		type: "string",
		form_type: "input",
		mutable: true,
		default_value: "",
		icon: "",
		options: [],
		required: true,
		ephemeral: false,
		...overrides,
	} as TemplateVersionParameter;
}

function createCollectCtx(
	params: Array<Partial<TemplateVersionParameter>> = [],
	previousValues: Array<{ name: string; value: string }> = [],
) {
	const workspace = createWorkspace();
	const restClient = {
		getTemplateVersionRichParameters: vi
			.fn()
			.mockResolvedValue(params.map(param)),
		getWorkspaceBuildParameters: vi.fn().mockResolvedValue(previousValues),
	};
	return {
		workspace,
		restClient: restClient as unknown as Api,
		mocks: restClient,
	};
}

interface QuickInputMock {
	mock: Record<string, unknown> & {
		show: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
	accept: (overrides?: Record<string, unknown>) => void;
	change: (value: string) => void;
	hide: () => void;
}

function quickInputMock(): QuickInputMock {
	let acceptCb: () => void = () => {};
	let hideCb: () => void = () => {};
	let changeCb: (v: string) => void = () => {};
	const mock = {
		title: "",
		step: 0,
		totalSteps: 0,
		prompt: "",
		placeholder: "",
		value: "",
		validationMessage: "",
		ignoreFocusOut: false,
		items: [] as readonly unknown[],
		selectedItems: [] as readonly unknown[],
		onDidAccept: vi.fn((cb: () => void) => {
			acceptCb = cb;
			return { dispose: vi.fn() };
		}),
		onDidHide: vi.fn((cb: () => void) => {
			hideCb = cb;
			return { dispose: vi.fn() };
		}),
		onDidChangeValue: vi.fn((cb: (v: string) => void) => {
			changeCb = cb;
			return { dispose: vi.fn() };
		}),
		show: vi.fn(),
		dispose: vi.fn(),
	};
	return {
		mock,
		accept(overrides) {
			Object.assign(mock, overrides ?? {});
			if (overrides && "value" in overrides) changeCb(mock.value);
			acceptCb();
		},
		change(value) {
			mock.value = value;
			changeCb(value);
		},
		hide() {
			hideCb();
		},
	};
}

function mockCreateInputBox() {
	const qi = quickInputMock();
	vi.mocked(vscode.window.createInputBox).mockReturnValue(
		qi.mock as unknown as vscode.InputBox,
	);
	return qi;
}

function mockCreateQuickPick() {
	const qi = quickInputMock();
	vi.mocked(vscode.window.createQuickPick).mockReturnValue(
		qi.mock as unknown as vscode.QuickPick<vscode.QuickPickItem>,
	);
	return qi;
}

async function waitShown(qi: QuickInputMock): Promise<void> {
	await vi.waitFor(() => expect(qi.mock.show).toHaveBeenCalled());
}

describe("collectUpdateParameters", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	interface CollectCase {
		kind: string;
		param: Partial<TemplateVersionParameter>;
		mock: () => QuickInputMock;
		accept: Record<string, unknown>;
		expected: Array<{ name: string; value: string }>;
	}

	it.each<CollectCase>([
		{
			kind: "text input",
			param: { name: "environment" },
			mock: mockCreateInputBox,
			accept: { value: "dev" },
			expected: [{ name: "environment", value: "dev" }],
		},
		{
			kind: "bool quick pick",
			param: { name: "enabled", type: "bool" },
			mock: mockCreateQuickPick,
			accept: { selectedItems: [{ value: "true" }] },
			expected: [{ name: "enabled", value: "true" }],
		},
		{
			kind: "options quick pick",
			param: {
				name: "size",
				options: [
					{ name: "Small", description: "", value: "s", icon: "" },
					{ name: "Large", description: "", value: "l", icon: "" },
				],
			},
			mock: mockCreateQuickPick,
			accept: { selectedItems: [{ value: "l" }] },
			expected: [{ name: "size", value: "l" }],
		},
		{
			kind: "multi-select quick pick (JSON array)",
			param: {
				name: "regions",
				form_type: "multi-select",
				options: [
					{ name: "US", description: "", value: "us", icon: "" },
					{ name: "EU", description: "", value: "eu", icon: "" },
				],
			},
			mock: mockCreateQuickPick,
			accept: { selectedItems: [{ value: "us" }, { value: "eu" }] },
			expected: [{ name: "regions", value: '["us","eu"]' }],
		},
	])(
		"collects the value via $kind",
		async ({ param: p, mock, accept, expected }) => {
			const { restClient, workspace } = createCollectCtx([p]);
			const qi = mock();

			const result = collectUpdateParameters(restClient, workspace);
			await waitShown(qi);
			qi.accept(accept);

			await expect(result).resolves.toEqual(expected);
		},
	);

	it("passes server-controlled values through verbatim (no shell expansion path)", async () => {
		const { restClient, workspace } = createCollectCtx([{ name: "evil" }]);
		const qi = mockCreateInputBox();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ value: "$(rm -rf /)" });

		await expect(result).resolves.toEqual([
			{ name: "evil", value: "$(rm -rf /)" },
		]);
	});

	it("skips parameters that already have a value or default", async () => {
		const { restClient, workspace } = createCollectCtx(
			[
				{ name: "existing" },
				{ name: "with_default", default_value: "foo" },
				{ name: "optional", required: false },
			],
			[{ name: "existing", value: "kept" }],
		);

		await expect(
			collectUpdateParameters(restClient, workspace),
		).resolves.toEqual([]);
		expect(vscode.window.createInputBox).not.toHaveBeenCalled();
	});

	it("prompts an immutable param that has no stored value (even if not required)", async () => {
		const { restClient, workspace } = createCollectCtx([
			{ name: "zone", required: false, mutable: false },
		]);
		const qi = mockCreateInputBox();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ value: "us-east" });

		await expect(result).resolves.toEqual([{ name: "zone", value: "us-east" }]);
	});

	it("skips an option param whose stored value is still in the new options", async () => {
		const optionParam: Partial<TemplateVersionParameter> = {
			name: "size",
			options: [
				{ name: "Small", description: "", value: "s", icon: "" },
				{ name: "Large", description: "", value: "l", icon: "" },
			],
		};
		const { restClient, workspace } = createCollectCtx(
			[optionParam],
			[{ name: "size", value: "l" }],
		);

		await expect(
			collectUpdateParameters(restClient, workspace),
		).resolves.toEqual([]);
		expect(vscode.window.createQuickPick).not.toHaveBeenCalled();
	});

	it("re-prompts when a stored option value drifted out of the new options", async () => {
		const optionParam: Partial<TemplateVersionParameter> = {
			name: "size",
			options: [
				{ name: "Small", description: "", value: "s", icon: "" },
				{ name: "Large", description: "", value: "l", icon: "" },
			],
		};
		const { restClient, workspace } = createCollectCtx(
			[optionParam],
			[{ name: "size", value: "xl-retired" }],
		);
		const qi = mockCreateQuickPick();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ selectedItems: [{ value: "l" }] });

		await expect(result).resolves.toEqual([{ name: "size", value: "l" }]);
	});

	it("re-prompts on drift even when the template parameter has a default value", async () => {
		const optionParam: Partial<TemplateVersionParameter> = {
			name: "size",
			default_value: "s",
			options: [
				{ name: "Small", description: "", value: "s", icon: "" },
				{ name: "Large", description: "", value: "l", icon: "" },
			],
		};
		const { restClient, workspace } = createCollectCtx(
			[optionParam],
			[{ name: "size", value: "xl-retired" }],
		);
		const qi = mockCreateQuickPick();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ selectedItems: [{ value: "l" }] });

		await expect(result).resolves.toEqual([{ name: "size", value: "l" }]);
	});

	it("re-prompts on drift for an immutable param too", async () => {
		const optionParam: Partial<TemplateVersionParameter> = {
			name: "zone",
			mutable: false,
			options: [{ name: "US", description: "", value: "us", icon: "" }],
		};
		const { restClient, workspace } = createCollectCtx(
			[optionParam],
			[{ name: "zone", value: "eu-retired" }],
		);
		const qi = mockCreateQuickPick();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ selectedItems: [{ value: "us" }] });

		await expect(result).resolves.toEqual([{ name: "zone", value: "us" }]);
	});

	it("re-prompts a multi-select when any stored pick drifted out", async () => {
		const multiParam: Partial<TemplateVersionParameter> = {
			name: "regions",
			form_type: "multi-select",
			options: [
				{ name: "US", description: "", value: "us", icon: "" },
				{ name: "EU", description: "", value: "eu", icon: "" },
			],
		};
		const { restClient, workspace } = createCollectCtx(
			[multiParam],
			[{ name: "regions", value: '["us","apac-retired"]' }],
		);
		const qi = mockCreateQuickPick();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ selectedItems: [{ value: "us" }] });

		await expect(result).resolves.toEqual([
			{ name: "regions", value: '["us"]' },
		]);
	});

	it("re-prompts a multi-select when the stored value isn't a JSON string array", async () => {
		const multiParam: Partial<TemplateVersionParameter> = {
			name: "regions",
			form_type: "multi-select",
			options: [{ name: "US", description: "", value: "us", icon: "" }],
		};
		const { restClient, workspace } = createCollectCtx(
			[multiParam],
			[{ name: "regions", value: "not-json" }],
		);
		const qi = mockCreateQuickPick();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.accept({ selectedItems: [{ value: "us" }] });

		await expect(result).resolves.toEqual([
			{ name: "regions", value: '["us"]' },
		]);
	});

	it("throws WorkspaceUpdateCancelledError when the prompt is dismissed", async () => {
		const { restClient, workspace } = createCollectCtx([{}]);
		const qi = mockCreateInputBox();

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		qi.hide();

		await expect(result).rejects.toBeInstanceOf(WorkspaceUpdateCancelledError);
	});

	it("steps the input title across multiple required params", async () => {
		const { restClient, workspace } = createCollectCtx([
			{ name: "a" },
			{ name: "b" },
		]);
		const inputs = [quickInputMock(), quickInputMock()];
		vi.mocked(vscode.window.createInputBox)
			.mockReturnValueOnce(inputs[0].mock as unknown as vscode.InputBox)
			.mockReturnValueOnce(inputs[1].mock as unknown as vscode.InputBox);

		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(inputs[0]);
		inputs[0].accept({ value: "first" });
		await waitShown(inputs[1]);
		inputs[1].accept({ value: "second" });
		await result;

		expect(inputs.map((i) => [i.mock.step, i.mock.totalSteps])).toEqual([
			[1, 2],
			[2, 2],
		]);
	});
});

describe("parameter prompt validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function withInputBox(
		p: Partial<TemplateVersionParameter>,
		fn: (qi: QuickInputMock) => void,
	) {
		const { restClient, workspace } = createCollectCtx([p]);
		const qi = mockCreateInputBox();
		const result = collectUpdateParameters(restClient, workspace);
		await waitShown(qi);
		fn(qi);
		qi.hide();
		await result.catch(() => {});
	}

	it("silently blocks accept on empty required input", async () => {
		await withInputBox({ name: "x" }, (qi) => {
			qi.accept({ value: "" });
			expect(qi.mock.validationMessage).toBe("");
			expect(qi.mock.dispose).not.toHaveBeenCalled();
		});
	});

	interface ValidationCase {
		kind: string;
		param: Partial<TemplateVersionParameter>;
		input: string;
		expected: string;
	}

	it.each<ValidationCase>([
		{
			kind: "number below validation_min",
			param: { type: "number", validation_min: 5 },
			input: "1",
			expected: "Must be at least 5",
		},
		{
			kind: "number above validation_max",
			param: { type: "number", validation_max: 9 },
			input: "10",
			expected: "Must be at most 9",
		},
		{
			kind: "non-numeric input on number param",
			param: { type: "number" },
			input: "abc",
			expected: "Must be a number",
		},
		{
			kind: "number out-of-range with {min}/{max} substitution",
			param: {
				type: "number",
				validation_min: 1,
				validation_max: 5,
				validation_error: "Pick {value} between {min} and {max}",
			},
			input: "7",
			expected: "Pick 7 between 1 and 5",
		},
	])("surfaces $kind", async ({ param: p, input, expected }) => {
		await withInputBox({ name: "x", ...p }, (qi) => {
			qi.change(input);
			expect(qi.mock.validationMessage).toBe(expected);
		});
	});

	it("does not evaluate validation_regex client-side (ReDoS guard)", async () => {
		await withInputBox({ name: "r", validation_regex: "^(a+)+$" }, (qi) => {
			qi.change("aaaaaaaaaaaaaaaaaaaaaaaaaaa!");
			expect(qi.mock.validationMessage).toBe("");
		});
	});

	it("treats JSON null on validation_min/max as unset", async () => {
		await withInputBox(
			{
				name: "n",
				type: "number",
				validation_min: null as unknown as number,
				validation_max: null as unknown as number,
			},
			(qi) => {
				qi.change("42");
				expect(qi.mock.validationMessage).toBe("");
				expect(qi.mock.placeholder).toBe("a number");
			},
		);
	});

	interface PlaceholderCase {
		kind: string;
		param: Partial<TemplateVersionParameter>;
		expected: string;
	}

	it.each<PlaceholderCase>([
		{
			kind: "between bounds",
			param: { type: "number", validation_min: 1, validation_max: 10 },
			expected: "between 1 and 10",
		},
		{
			kind: "lower bound only",
			param: { type: "number", validation_min: 1 },
			expected: "at least 1",
		},
		{
			kind: "upper bound only",
			param: { type: "number", validation_max: 10 },
			expected: "at most 10",
		},
		{
			kind: "regex with custom error",
			param: { validation_regex: "^x", validation_error: "must start with x" },
			expected: "must start with x",
		},
	])("renders placeholder for $kind", async ({ param: p, expected }) => {
		await withInputBox({ name: "x", ...p }, (qi) => {
			expect(qi.mock.placeholder).toBe(expected);
		});
	});
});
