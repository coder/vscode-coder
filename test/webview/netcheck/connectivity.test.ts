import { describe, expect, it } from "vitest";

import { buildConnectivityItems } from "@repo/netcheck/connectivity";

import { report } from "./fixtures";

describe("buildConnectivityItems", () => {
	it("returns nothing when the probe section is missing", () => {
		expect(buildConnectivityItems(report())).toEqual([]);
	});

	it("derives tones and labels from the probe", () => {
		const items = buildConnectivityItems(
			report({
				derp: {
					severity: "ok",
					warnings: [],
					regions: {
						"999": {
							severity: "ok",
							region: {
								RegionID: 999,
								RegionName: "Embedded",
								EmbeddedRelay: true,
							},
							node_reports: [],
						},
					},
					netcheck: {
						UDP: false,
						IPv4: true,
						IPv6: false,
						MappingVariesByDestIP: true,
						HairPinning: null,
						UPnP: true,
						PMP: false,
						PCP: true,
						PreferredDERP: 999,
						RegionLatency: {},
					},
				},
			}),
		);

		const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
		expect(byLabel["UDP"]).toMatchObject({ value: "Blocked", tone: "bad" });
		expect(byLabel["IPv4"]).toMatchObject({ value: "Yes", tone: "good" });
		expect(byLabel["IPv6"]).toMatchObject({ value: "No", tone: "neutral" });
		expect(byLabel["NAT mapping"]).toMatchObject({
			value: "Varies by destination (hard NAT)",
			tone: "warn",
		});
		expect(byLabel["Hairpinning"]).toMatchObject({
			value: "Unknown",
			tone: "neutral",
		});
		expect(byLabel["Port mapping"]).toMatchObject({
			value: "UPnP, PCP",
			tone: "good",
		});
		expect(byLabel["Preferred relay"]).toMatchObject({ value: "Embedded" });
	});
});
