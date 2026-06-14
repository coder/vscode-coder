import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { NetcheckPanelFactory } from "@/webviews/netcheck/netcheckPanelFactory";

import { NetcheckApi, type NetcheckReport } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
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
						can_exchange_messages: true,
						round_trip_ping_ms: 60,
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

// The shared panel mechanism (visibility/theme re-push, disposal, viewJson) is
// covered by resultPanel.test.ts; this only checks the netcheck-specific wiring.
describe("NetcheckPanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("opens a titled webview and pushes the host and report after the webview signals ready", () => {
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
});
