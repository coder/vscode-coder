import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { WorkspaceUpdateCancelledError } from "@/api/updateParameters";
import { WorkspaceUpdatePanelFactory } from "@/webviews/workspaceUpdate/workspaceUpdatePanelFactory";

import { workspace } from "@repo/mocks";
import { WorkspaceUpdateApi } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
} from "../../../mocks/testHelpers";

import type {
	FriendlyDiagnostic,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

const ERROR: FriendlyDiagnostic = {
	severity: "error",
	summary: "Invalid",
	detail: "",
	extra: { code: "" },
};

function parameter(overrides: Partial<PreviewParameter>): PreviewParameter {
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

function option(value: string) {
	return {
		name: value,
		description: "",
		value: { valid: true, value },
		icon: "",
	};
}

function setup(parameters: PreviewParameter[]) {
	const { panel, hooks } = createMockWebviewPanel(
		"coder.workspaceUpdate",
		"Update",
		vscode.ViewColumn.One,
	);
	vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel);
	const client: Pick<
		CoderApi,
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
		template_active_version_id: "version-2",
		latest_build: { status: "running" },
	});
	const result = new WorkspaceUpdatePanelFactory(
		vscode.Uri.file("/ext"),
		createMockLogger(),
	).collectParameters(client as CoderApi, ws);

	const formOpened = () =>
		vi.waitFor(() =>
			expect(vscode.window.createWebviewPanel).toHaveBeenCalled(),
		);
	const request = async (method: string, params?: unknown) => {
		await formOpened();
		const requestId = crypto.randomUUID();
		hooks.sendFromWebview({ requestId, method, params });
		return vi.waitFor(() => {
			const response = hooks.postedMessages.find(
				(m) => (m as { requestId?: string }).requestId === requestId,
			);
			expect(response).toBeDefined();
			return response as { success: boolean; data: unknown };
		});
	};
	return { panel, hooks, client, ws, result, request, formOpened };
}

/** The new version rejects `size`, so the form opens. */
const REJECTED = [
	parameter({ name: "region" }),
	parameter({
		name: "size",
		form_type: "dropdown",
		options: [option("small")],
		diagnostics: [ERROR],
	}),
	parameter({ name: "token", ephemeral: true }),
];

describe("WorkspaceUpdatePanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("keeps the current values without a form when the new version accepts them", async () => {
		const { result, client, ws } = setup([parameter({ name: "region" })]);

		expect(await result).toEqual([]);
		expect(client.getTemplateVersionDynamicParameters).toHaveBeenCalledWith(
			"version-2",
			{
				id: 0,
				owner_id: ws.owner_id,
				inputs: { region: "eu", size: "retired", token: "old" },
			},
		);
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
	});

	it("opens the form with the previous values the new version still accepts", async () => {
		const { request } = setup(REJECTED);

		expect(await request(WorkspaceUpdateApi.init.method)).toMatchObject({
			success: true,
			data: {
				workspaceName: "testuser/test-workspace",
				values: { region: "eu" },
				restart: true,
			},
		});
	});

	it("resolves with the submitted values and closes", async () => {
		const { hooks, result, panel, formOpened } = setup(REJECTED);
		const dispose = vi.spyOn(panel, "dispose");
		await formOpened();

		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.submit.method,
			params: { size: "small" },
		});

		expect(await result).toEqual([{ name: "size", value: "small" }]);
		expect(dispose).toHaveBeenCalled();
	});

	it("rejects as cancelled when closed", async () => {
		const { hooks, result, formOpened } = setup(REJECTED);
		await formOpened();

		hooks.sendFromWebview({ method: WorkspaceUpdateApi.cancel.method });

		await expect(result).rejects.toBeInstanceOf(WorkspaceUpdateCancelledError);
	});
});
