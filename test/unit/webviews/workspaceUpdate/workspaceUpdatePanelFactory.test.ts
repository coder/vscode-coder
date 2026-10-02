import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { WorkspaceUpdateCancelledError } from "@/api/updateParameters";
import { WorkspaceUpdatePanelFactory } from "@/webviews/workspaceUpdate/workspaceUpdatePanelFactory";

import { previewParameter } from "@repo/mocks";
import { WorkspaceUpdateApi, type WorkspaceUpdateInit } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
	sendWebviewRequest,
} from "../../../mocks/testHelpers";

import type { EvaluateParameters } from "@/api/dynamicParameters";

const EVALUATION = {
	id: 0,
	parameters: [previewParameter({ name: "region" })],
	diagnostics: [],
};

const INIT: WorkspaceUpdateInit = {
	workspaceName: "testuser/test-workspace",
	values: { region: "eu" },
	evaluation: EVALUATION,
	restart: true,
};

function setup() {
	const { panel, hooks } = createMockWebviewPanel(
		"coder.workspaceUpdate",
		"Update",
		vscode.ViewColumn.One,
	);
	vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel);
	const evaluate = vi.fn<EvaluateParameters>().mockResolvedValue(EVALUATION);
	const result = new WorkspaceUpdatePanelFactory(
		vscode.Uri.file("/ext"),
		createMockLogger(),
	).show(INIT, evaluate);
	return { panel, hooks, evaluate, result };
}

describe("WorkspaceUpdatePanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("serves the initial state and evaluations to the form", async () => {
		const { hooks, evaluate } = setup();

		expect(
			await sendWebviewRequest(hooks, WorkspaceUpdateApi.init),
		).toMatchObject({ success: true, data: INIT });
		expect(
			await sendWebviewRequest(hooks, WorkspaceUpdateApi.evaluate, {
				region: "us",
			}),
		).toMatchObject({ success: true, data: EVALUATION });
		expect(evaluate).toHaveBeenCalledWith({ region: "us" });
	});

	it("resolves with the submitted values and closes", async () => {
		const { hooks, result, panel } = setup();
		const dispose = vi.spyOn(panel, "dispose");

		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.submit.method,
			params: { size: "small" },
		});

		expect(await result).toEqual([{ name: "size", value: "small" }]);
		expect(dispose).toHaveBeenCalled();
	});

	it("rejects as cancelled when closed", async () => {
		const { hooks, result } = setup();

		hooks.sendFromWebview({ method: WorkspaceUpdateApi.cancel.method });

		await expect(result).rejects.toBeInstanceOf(WorkspaceUpdateCancelledError);
	});
});
