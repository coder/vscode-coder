import { describe, expect, it } from "vitest";

import {
	buildConnectivityItems,
	buildRegionRows,
	collectIssues,
	formatLatency,
	formatTriState,
	nanosToMs,
	sectionSummary,
} from "@repo/netcheck/render";

import type { NetcheckReport } from "@repo/shared";

function report(overrides?: {
	derp?: Partial<NetcheckReport["derp"]>;
	interfaces?: Partial<NetcheckReport["interfaces"]>;
}): NetcheckReport {
	return {
		derp: {
			severity: "ok",
			warnings: [],
			regions: {},
			...overrides?.derp,
		},
		interfaces: {
			severity: "ok",
			warnings: [],
			interfaces: [],
			...overrides?.interfaces,
		},
	};
}

describe("formatLatency", () => {
	it("formats missing, sub-millisecond, fractional, and large values", () => {
		expect(formatLatency(undefined)).toBe("—");
		expect(formatLatency(0.4)).toBe("<1 ms");
		expect(formatLatency(27.706829)).toBe("27.7 ms");
		expect(formatLatency(251.640563)).toBe("252 ms");
	});
});

describe("nanosToMs", () => {
	it("converts nanoseconds to milliseconds", () => {
		expect(nanosToMs(27706829)).toBeCloseTo(27.706829);
	});
});

describe("formatTriState", () => {
	it("maps yes/no to the given labels and unknown to a dash", () => {
		expect(formatTriState("yes", { yes: "Yes", no: "Failed" })).toBe("Yes");
		expect(formatTriState("no", { yes: "Yes", no: "Failed" })).toBe("Failed");
		expect(formatTriState("unknown", { yes: "Yes", no: "Failed" })).toBe("—");
	});
});

describe("sectionSummary", () => {
	it("summarizes severity with warning counts", () => {
		expect(
			sectionSummary("DERP & STUN", {
				severity: "ok",
				warnings: [],
			}),
		).toBe("DERP & STUN: healthy");
		expect(
			sectionSummary("DERP & STUN", {
				severity: "warning",
				warnings: [{ code: "X", message: "m" }],
			}),
		).toBe("DERP & STUN: 1 warning");
		expect(
			sectionSummary("Local interfaces", {
				severity: "error",
				warnings: [],
			}),
		).toBe("Local interfaces: error");
	});
});

describe("collectIssues", () => {
	it("lists section errors before warnings", () => {
		const issues = collectIssues(
			report({
				derp: {
					severity: "warning",
					warnings: [{ code: "EDERP01", message: "latency is high" }],
					netcheck_err: "probe failed",
				},
				interfaces: {
					severity: "warning",
					warnings: [{ code: "EIF01", message: "MTU is low" }],
				},
			}),
		);

		expect(issues).toEqual([
			{ kind: "error", message: "probe failed" },
			{ kind: "warning", code: "EDERP01", message: "latency is high" },
			{ kind: "warning", code: "EIF01", message: "MTU is low" },
		]);
	});

	it("returns nothing for a healthy report", () => {
		expect(collectIssues(report())).toEqual([]);
	});
});

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

describe("buildRegionRows", () => {
	const baseNode = {
		severity: "ok",
		can_exchange_messages: true,
		round_trip_ping_ms: 60,
		uses_websocket: false,
		stun: { Enabled: false, CanSTUN: false },
		node: { STUNOnly: false },
	} as const;

	it("derives latency from the probe, falling back to node round trips", () => {
		const rows = buildRegionRows(
			report({
				derp: {
					severity: "ok",
					warnings: [],
					regions: {
						"1": {
							severity: "ok",
							region: {
								RegionID: 1,
								RegionName: "Probed",
								EmbeddedRelay: false,
							},
							node_reports: [baseNode],
						},
						"2": {
							severity: "ok",
							region: {
								RegionID: 2,
								RegionName: "Pinged",
								EmbeddedRelay: false,
							},
							node_reports: [baseNode],
						},
					},
					netcheck: {
						UDP: true,
						IPv4: true,
						IPv6: false,
						PreferredDERP: 0,
						RegionLatency: { "1": 30_000_000 },
					},
				},
			}),
		);

		const probed = rows.find((r) => r.name === "Probed");
		const pinged = rows.find((r) => r.name === "Pinged");
		expect(probed?.latencyMs).toBe(30);
		expect(pinged?.latencyMs).toBe(60);
	});

	it("sorts the preferred region first, then by latency", () => {
		const region = (id: number, name: string) => ({
			severity: "ok" as const,
			region: { RegionID: id, RegionName: name, EmbeddedRelay: false },
			node_reports: [baseNode],
		});
		const rows = buildRegionRows(
			report({
				derp: {
					severity: "ok",
					warnings: [],
					regions: {
						"1": region(1, "Fast"),
						"2": region(2, "Slow"),
						"3": region(3, "Preferred"),
					},
					netcheck: {
						UDP: true,
						IPv4: true,
						IPv6: false,
						PreferredDERP: 3,
						RegionLatency: {
							"1": 10_000_000,
							"2": 90_000_000,
							"3": 50_000_000,
						},
					},
				},
			}),
		);

		expect(rows.map((r) => r.name)).toEqual(["Preferred", "Fast", "Slow"]);
		expect(rows[0].preferred).toBe(true);
	});

	it("marks STUN-only regions as not relaying and reports STUN capability", () => {
		const rows = buildRegionRows(
			report({
				derp: {
					severity: "ok",
					warnings: [],
					regions: {
						"1000": {
							severity: "ok",
							region: {
								RegionID: 1000,
								RegionName: "STUN only",
								EmbeddedRelay: false,
							},
							node_reports: [
								{
									severity: "ok",
									can_exchange_messages: false,
									round_trip_ping_ms: 0,
									uses_websocket: false,
									stun: { Enabled: true, CanSTUN: true },
									node: { STUNOnly: true },
								},
							],
						},
					},
				},
			}),
		);

		expect(rows[0]).toMatchObject({
			name: "STUN only",
			stun: "yes",
			relay: "unknown",
			latencyMs: undefined,
		});
	});

	it("falls back to a numeric name when region metadata is missing", () => {
		const rows = buildRegionRows(
			report({
				derp: {
					severity: "ok",
					warnings: [],
					regions: {
						"7": { severity: "ok", node_reports: [] },
					},
				},
			}),
		);
		expect(rows[0].name).toBe("Region 7");
	});
});
