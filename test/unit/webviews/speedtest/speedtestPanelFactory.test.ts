import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { SpeedtestPanelFactory } from "@/webviews/speedtest/speedtestPanelFactory";

import { type SpeedtestResult, SpeedtestApi } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
	type WebviewPanelTestHooks,
} from "../../../mocks/testHelpers";

const sampleResult: SpeedtestResult = {
	overall: {
		start_time_seconds: 0,
		end_time_seconds: 5,
		throughput_mbits: 100,
	},
	intervals: [
		{ start_time_seconds: 0, end_time_seconds: 1, throughput_mbits: 95 },
		{ start_time_seconds: 1, end_time_seconds: 2, throughput_mbits: 105 },
	],
};

interface Harness {
	panel: vscode.WebviewPanel;
	hooks: WebviewPanelTestHooks;
}

function openChart(rawJson = '{"raw":true}'): Harness {
	let panel!: vscode.WebviewPanel;
	let hooks!: WebviewPanelTestHooks;

	vi.mocked(vscode.window.createWebviewPanel).mockImplementation((...args) => {
		const built = createMockWebviewPanel(...args);
		panel = built.panel;
		hooks = built.hooks;
		return panel;
	});

	const factory = new SpeedtestPanelFactory(
		vscode.Uri.file("/ext"),
		createMockLogger(),
	);

	factory.show({
		result: sampleResult,
		rawJson,
		workspaceId: "my-workspace",
	});
	return { panel, hooks };
}

// The shared panel mechanism (visibility/theme re-push, disposal, viewJson) is
// covered by resultPanel.test.ts; this only checks the speedtest-specific wiring.
describe("SpeedtestPanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("opens a titled webview and pushes the workspace result after the webview signals ready", () => {
		const { panel, hooks } = openChart();

		expect(panel.viewType).toBe("coder.speedtestPanel");
		expect(panel.title).toBe("Speed Test: my-workspace");
		expect(panel.webview.html).toContain("Speed Test: my-workspace");
		expect(hooks.postedMessages).toEqual([]);

		hooks.sendFromWebview({ method: SpeedtestApi.ready.method });

		expect(hooks.postedMessages).toEqual([
			{
				type: SpeedtestApi.data.method,
				data: { workspaceId: "my-workspace", result: sampleResult },
			},
		]);
	});
});
