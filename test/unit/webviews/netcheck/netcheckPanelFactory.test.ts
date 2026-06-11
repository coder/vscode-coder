import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { NetcheckPanelFactory } from "@/webviews/netcheck/netcheckPanelFactory";

import { NetcheckApi, type NetcheckReport } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
	setActiveColorTheme,
	type WebviewPanelTestHooks,
} from "../../../mocks/testHelpers";

const sampleReport: NetcheckReport = {
	derp: {
		severity: "ok",
		warnings: [],
		regions: {
			"999": {
				severity: "ok",
				region: { RegionID: 999, RegionName: "Embedded", EmbeddedRelay: true },
				node_reports: [
					{
						severity: "ok",
						can_exchange_messages: true,
						round_trip_ping_ms: 60,
						uses_websocket: false,
						stun: { Enabled: false, CanSTUN: false },
					},
				],
			},
		},
		netcheck: {
			UDP: true,
			IPv4: true,
			IPv6: false,
			PreferredDERP: 999,
			RegionLatency: { "999": 27706829 },
		},
	},
	interfaces: {
		severity: "ok",
		warnings: [],
		interfaces: [{ name: "eth0", mtu: 1500, addresses: ["172.20.0.99/16"] }],
	},
};

interface Harness {
	panel: vscode.WebviewPanel;
	hooks: WebviewPanelTestHooks;
}

function openReport(rawJson = '{"raw":true}'): Harness {
	let panel!: vscode.WebviewPanel;
	let hooks!: WebviewPanelTestHooks;

	vi.mocked(vscode.window.createWebviewPanel).mockImplementation((...args) => {
		const built = createMockWebviewPanel(...args);
		panel = built.panel;
		hooks = built.hooks;
		return panel;
	});

	const factory = new NetcheckPanelFactory(
		vscode.Uri.file("/ext"),
		createMockLogger(),
	);

	factory.show({ host: "dev.coder.com", report: sampleReport }, rawJson);
	return { panel, hooks };
}

describe("NetcheckPanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("opens a titled webview with HTML and pushes the payload after the webview signals ready", () => {
		const { panel, hooks } = openReport();

		expect(panel.viewType).toBe("coder.netcheckPanel");
		expect(panel.title).toBe("Network Check: dev.coder.com");
		expect(panel.webview.html).toContain("Network Check: dev.coder.com");
		expect(hooks.postedMessages).toEqual([]);

		hooks.sendFromWebview({ method: NetcheckApi.ready.method });

		expect(hooks.postedMessages).toEqual([
			{
				type: NetcheckApi.data.method,
				data: { host: "dev.coder.com", report: sampleReport },
			},
		]);
	});

	it("re-pushes the payload when the panel returns to visible", () => {
		const { hooks } = openReport();
		hooks.sendFromWebview({ method: NetcheckApi.ready.method });
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("does not push while the panel is hidden", () => {
		const { hooks } = openReport();
		hooks.sendFromWebview({ method: NetcheckApi.ready.method });
		const before = hooks.postedMessages.length;

		hooks.setVisible(false);

		expect(hooks.postedMessages.length).toBe(before);
	});

	it("re-pushes the payload on theme change while visible", () => {
		const { hooks } = openReport();
		hooks.sendFromWebview({ method: NetcheckApi.ready.method });
		const before = hooks.postedMessages.length;

		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("opens the raw JSON beside when the webview requests viewJson", async () => {
		const doc = { uri: vscode.Uri.file("/tmp/doc") } as vscode.TextDocument;
		vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(doc);

		const { hooks } = openReport('{"ok":1}');
		hooks.sendFromWebview({ method: NetcheckApi.viewJson.method });

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

	it("does not surface an error dialog for unknown command methods", async () => {
		const { hooks } = openReport();
		hooks.sendFromWebview({ method: "netcheck/bogus" });
		// Dispatch is async; let the rejection settle before asserting.
		await Promise.resolve();
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	it("stops responding to visibility and theme events after disposal", () => {
		const { hooks } = openReport();
		hooks.fireDispose();
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);
		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length).toBe(before);
	});
});
