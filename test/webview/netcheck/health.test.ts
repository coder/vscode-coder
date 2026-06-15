import { describe, expect, it } from "vitest";

import { collectIssues, sectionSummary } from "@repo/netcheck/health";

import { report } from "./fixtures";

describe("sectionSummary", () => {
	it("summarizes severity with warning counts", () => {
		expect(sectionSummary({ severity: "ok", warnings: [] })).toBe("healthy");
		expect(
			sectionSummary({
				severity: "warning",
				warnings: [{ code: "X", message: "m" }],
			}),
		).toBe("1 warning");
		expect(
			sectionSummary({
				severity: "warning",
				warnings: [
					{ code: "X", message: "m" },
					{ code: "Y", message: "n" },
				],
			}),
		).toBe("2 warnings");
		expect(sectionSummary({ severity: "error", warnings: [] })).toBe("error");
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

	it("includes per-region errors and warnings, prefixed with the region name", () => {
		const issues = collectIssues(
			report({
				derp: {
					regions: {
						"5": {
							severity: "error",
							error: "region unreachable",
							warnings: [{ code: "ERLY", message: "high latency" }],
							region: {
								RegionID: 5,
								RegionName: "Tokyo",
								EmbeddedRelay: false,
							},
							node_reports: [],
						},
					},
				},
			}),
		);

		expect(issues).toEqual([
			{ kind: "error", message: "Tokyo: region unreachable" },
			{ kind: "warning", code: "ERLY", message: "Tokyo: high latency" },
		]);
	});

	it("synthesizes an issue for a region whose node is unhealthy but carries no message", () => {
		const issues = collectIssues(
			report({
				derp: {
					regions: {
						"3": {
							severity: "error",
							region: { RegionID: 3, RegionName: "Frankfurt", EmbeddedRelay: true },
							node_reports: [
								{
									can_exchange_messages: false,
									round_trip_ping_ms: 0,
									stun: { Enabled: true, CanSTUN: true },
								},
							],
						},
					},
				},
			}),
		);

		expect(issues).toEqual([
			{ kind: "error", message: "Frankfurt: a node failed its health check" },
		]);
	});

	it("returns nothing for a healthy report", () => {
		expect(collectIssues(report())).toEqual([]);
	});
});
