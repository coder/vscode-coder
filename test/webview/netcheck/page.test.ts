import { describe, expect, it } from "vitest";

import { renderPage } from "@repo/netcheck/page";

import { report } from "./fixtures";

import type { NetcheckData } from "@repo/shared";

function mount(els: HTMLElement[]): HTMLElement {
	const root = document.createElement("div");
	root.append(...els);
	return root;
}

const headings = (root: HTMLElement) =>
	[...root.querySelectorAll("h2")].map((h) => h.textContent);

function golden(): NetcheckData {
	return {
		host: "coder.example.com",
		report: report({
			derp: {
				severity: "warning",
				warnings: [{ code: "EDERP01", message: "latency is high" }],
				regions: {
					"1": {
						severity: "ok",
						region: {
							RegionID: 1,
							RegionName: "New York",
							EmbeddedRelay: true,
						},
						node_reports: [
							{
								can_exchange_messages: true,
								round_trip_ping_ms: 12,
								stun: { Enabled: true, CanSTUN: true },
								node: { STUNOnly: false },
							},
						],
					},
				},
				netcheck: {
					UDP: true,
					IPv4: true,
					IPv6: false,
					PreferredDERP: 1,
					RegionLatency: { "1": 12_000_000 },
				},
			},
			interfaces: {
				severity: "ok",
				warnings: [],
				interfaces: [{ name: "eth0", mtu: 1500, addresses: ["10.0.0.2"] }],
			},
		}),
	};
}

describe("renderPage", () => {
	it("renders every section with the host, badges, and the View JSON action", () => {
		const root = mount(renderPage(golden(), () => undefined));

		expect(root.querySelector("h1")?.textContent).toBe("coder.example.com");
		expect(headings(root)).toEqual([
			"Issues",
			"Connectivity",
			"DERP relay regions",
			"Local interfaces",
		]);
		expect(
			[...root.querySelectorAll(".badge")].map((b) => b.textContent),
		).toEqual(["Preferred", "Embedded"]);
		expect(root.querySelector(".actions button")?.textContent).toBe(
			"View JSON",
		);
	});

	it("shows empty-state messages and omits Issues for a healthy, empty report", () => {
		const root = mount(
			renderPage({ host: "h", report: report() }, () => undefined),
		);

		// Connectivity, regions, and interfaces each render their empty state.
		expect(root.querySelectorAll("p.empty")).toHaveLength(3);
		expect(headings(root)).not.toContain("Issues");
	});
});
