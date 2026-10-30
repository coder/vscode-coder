import { describe, expect, it, vi } from "vitest";

import {
	collectDynamicParameters,
	reviseRejectedParameters,
	usesDynamicParameters,
	type ShowUpdateForm,
} from "@/api/dynamicParameters";

import {
	diagnostic,
	parameterOption,
	previewParameter,
	workspace,
} from "@repo/mocks";

import type { Api } from "coder/site/src/api/api";
import type { PreviewParameter } from "coder/site/src/api/typesGenerated";

function setup(parameters: PreviewParameter[]) {
	const client: Pick<
		Api,
		"getWorkspaceBuildParameters" | "getTemplateVersionDynamicParameters"
	> = {
		getWorkspaceBuildParameters: vi.fn().mockResolvedValue([
			{ name: "region", value: "eu" },
			{ name: "size", value: "retired" },
			{ name: "token", value: "old" },
		]),
		getTemplateVersionDynamicParameters: vi
			.fn()
			.mockResolvedValue({ id: 0, parameters, diagnostics: null }),
	};
	const ws = workspace({
		template_use_classic_parameter_flow: false,
		template_active_version_id: "version-2",
		latest_build: { status: "running" },
	});
	const showForm = vi.fn<ShowUpdateForm>().mockResolvedValue([]);
	return { client: client as Api, ws, showForm };
}

describe("usesDynamicParameters", () => {
	it.each([
		{ flag: false, supported: true, expected: true },
		{ flag: true, supported: true, expected: false },
		{ flag: undefined, supported: true, expected: false },
		{ flag: false, supported: false, expected: false },
	])(
		"flag $flag on a server with support $supported is $expected",
		({ flag, supported, expected }) => {
			const ws = workspace({ template_use_classic_parameter_flow: flag });
			expect(usesDynamicParameters(ws, { dynamicParameters: supported })).toBe(
				expected,
			);
		},
	);
});

describe("collectDynamicParameters", () => {
	it("keeps the previous values without a form when the new version accepts them", async () => {
		const { client, ws, showForm } = setup([
			previewParameter({ name: "region" }),
		]);

		expect(await collectDynamicParameters(client, ws, showForm)).toEqual([]);
		expect(client.getTemplateVersionDynamicParameters).toHaveBeenCalledWith(
			"version-2",
			{
				id: 0,
				owner_id: ws.owner_id,
				inputs: { region: "eu", size: "retired", token: "old" },
			},
		);
		expect(showForm).not.toHaveBeenCalled();
	});

	it("opens the form with the previous values the new version still accepts", async () => {
		const parameters = [
			previewParameter({ name: "region" }),
			previewParameter({
				name: "size",
				form_type: "dropdown",
				options: [parameterOption("small")],
				diagnostics: [diagnostic("Invalid")],
			}),
			previewParameter({ name: "token", ephemeral: true }),
		];
		const { client, ws, showForm } = setup(parameters);
		await collectDynamicParameters(client, ws, showForm);

		const values = { region: "eu" };
		expect(showForm).toHaveBeenCalledWith(
			{
				workspaceName: "testuser/test-workspace",
				values,
				evaluation: { id: 0, parameters, diagnostics: [] },
				restart: true,
			},
			expect.any(Function),
		);
		expect(client.getTemplateVersionDynamicParameters).toHaveBeenLastCalledWith(
			"version-2",
			expect.objectContaining({ inputs: values }),
		);
	});

	it("evaluates once when the new version accepts every previous value", async () => {
		const { client, ws, showForm } = setup([
			previewParameter({ name: "region" }),
			previewParameter({ name: "size" }),
			previewParameter({ name: "token" }),
			previewParameter({ name: "gpu", diagnostics: [diagnostic("Required")] }),
		]);
		await collectDynamicParameters(client, ws, showForm);

		expect(client.getTemplateVersionDynamicParameters).toHaveBeenCalledOnce();
		expect(showForm).toHaveBeenCalledWith(
			expect.objectContaining({
				values: { region: "eu", size: "retired", token: "old" },
			}),
			expect.any(Function),
		);
	});
});

describe("reviseRejectedParameters", () => {
	it("reopens the form on the rejected values with the server's reasons", async () => {
		const { client, ws, showForm } = setup([
			previewParameter({ name: "region" }),
		]);

		await reviseRejectedParameters(
			client,
			ws,
			[{ name: "region", value: "mars" }],
			[
				{ field: "region", detail: "Unknown region" },
				{ field: "quota", detail: "Over quota" },
			],
			showForm,
		);

		const [init] = showForm.mock.lastCall ?? [];
		expect(init?.values).toEqual({
			region: "mars",
			size: "retired",
			token: "old",
		});
		expect(init?.evaluation.diagnostics).toEqual([
			diagnostic("region: Unknown region"),
			diagnostic("quota: Over quota"),
		]);
	});
});
