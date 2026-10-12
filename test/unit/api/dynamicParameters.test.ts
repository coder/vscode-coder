import { describe, expect, it, vi } from "vitest";

import {
	reviseRejectedParameters,
	type ShowUpdateForm,
} from "@/api/dynamicParameters";
import { collectUpdateParameters } from "@/api/updateParameters";

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
	const result = collectUpdateParameters(client as Api, ws, showForm);
	return { client, ws, showForm, result };
}

describe("collectUpdateParameters with dynamic parameters", () => {
	it("keeps the previous values without a form when the new version accepts them", async () => {
		const { client, ws, showForm, result } = setup([
			previewParameter({ name: "region" }),
		]);

		expect(await result).toEqual([]);
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
		const { client, showForm, result } = setup(parameters);
		await result;

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
});

describe("reviseRejectedParameters", () => {
	it("reopens the form on the rejected values with the server's reasons", async () => {
		const { client, ws, showForm } = setup([
			previewParameter({ name: "region" }),
		]);

		await reviseRejectedParameters(
			client as Api,
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
