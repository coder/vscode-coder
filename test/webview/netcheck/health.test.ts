import { describe, expect, it } from "vitest";

import { collectIssues, sectionSummary } from "@repo/netcheck/health";

import { report } from "./fixtures";

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
