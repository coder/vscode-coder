import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { SpeedtestPanelFactory } from "@/webviews/speedtest/speedtestPanelFactory";

import { type SpeedtestResult, SpeedtestApi } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
	setActiveColorTheme,
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
		workspaceName: "my-workspace",
	});
	return { panel, hooks };
}

describe("SpeedtestPanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("opens a titled webview with HTML and pushes the initial payload", () => {
		const { panel, hooks } = openChart();

		expect(panel.viewType).toBe("coder.speedtestPanel");
		expect(panel.title).toBe("Speed Test: my-workspace");
		expect(panel.webview.html).toContain("Speed Test: my-workspace");
		expect(hooks.postedMessages).toEqual([
			{
				type: SpeedtestApi.data.method,
				data: { workspaceName: "my-workspace", result: sampleResult },
			},
		]);
	});

	it("re-pushes the payload when the panel returns to visible", () => {
		const { hooks } = openChart();
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("does not push while the panel is hidden", () => {
		const { hooks } = openChart();
		const before = hooks.postedMessages.length;

		hooks.setVisible(false);

		expect(hooks.postedMessages.length).toBe(before);
	});

	it("re-pushes the payload on theme change while visible", () => {
		const { hooks } = openChart();
		const before = hooks.postedMessages.length;

		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("opens the raw JSON beside when the webview requests viewJson", async () => {
		const doc = { uri: vscode.Uri.file("/tmp/doc") } as vscode.TextDocument;
		vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(doc);

		const { hooks } = openChart('{"ok":1}');
		hooks.sendFromWebview({ method: SpeedtestApi.viewJson.method });

		await vi.waitFor(() =>
			expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
				doc,
				vscode.ViewColumn.Beside,
			),
		);
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
			content: '{"ok":1}',
			language: "json",
		});
	});

	it("ignores unknown message methods", () => {
		const { hooks } = openChart();
		expect(() =>
			hooks.sendFromWebview({ method: "speedtest/bogus" }),
		).not.toThrow();
	});

	it("stops responding to visibility and theme events after disposal", () => {
		const { hooks } = openChart();
		hooks.fireDispose();
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);
		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length).toBe(before);
	});
});
