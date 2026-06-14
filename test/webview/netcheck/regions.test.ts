import { describe, expect, it } from "vitest";

import { buildRegionRows } from "@repo/netcheck/regions";

import { report } from "./fixtures";

describe("buildRegionRows", () => {
	const baseNode = {
		can_exchange_messages: true,
		round_trip_ping_ms: 60,
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
									can_exchange_messages: false,
									round_trip_ping_ms: 0,
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
