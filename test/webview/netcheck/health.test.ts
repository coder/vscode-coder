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

	it("returns nothing for a healthy report", () => {
		expect(collectIssues(report())).toEqual([]);
	});
});
