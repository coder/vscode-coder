import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { parseNetcheckReport } from "@/webviews/netcheck/types";

// A trimmed-but-realistic `coder netcheck` payload, including CLI fields the
// parser ignores (node_info, client_logs, RegionV4Latency, ...).
import validReport from "./fixtures/netcheck-report.json";

describe("parseNetcheckReport", () => {
	it("parses a realistic CLI payload", () => {
		const report = parseNetcheckReport(JSON.stringify(validReport));

		expect(report.derp.severity).toBe("ok");
		expect(Object.keys(report.derp.regions)).toEqual(["999", "1000"]);
		expect(report.derp.regions["999"].region?.RegionName).toBe(
			"Council Bluffs, Iowa",
		);
		expect(report.derp.regions["999"].node_reports[0].round_trip_ping_ms).toBe(
			60,
		);
		expect(report.derp.netcheck?.PreferredDERP).toBe(999);
		expect(report.derp.netcheck?.RegionLatency["999"]).toBe(27706829);
		expect(report.interfaces.interfaces).toHaveLength(2);
	});

	it("normalizes null warning lists to empty arrays", () => {
		const report = parseNetcheckReport(JSON.stringify(validReport));
		expect(report.interfaces.warnings).toEqual([]);
		expect(report.derp.warnings).toEqual([]);
	});

	it("drops null region entries", () => {
		const withNullRegion = structuredClone(validReport) as Record<
			string,
			unknown
		> & { derp: { regions: Record<string, unknown> } };
		withNullRegion.derp.regions["1001"] = null;

		const report = parseNetcheckReport(JSON.stringify(withNullRegion));
		expect(Object.keys(report.derp.regions)).toEqual(["999", "1000"]);
	});

	it("tolerates a missing netcheck probe section", () => {
		const withoutProbe = structuredClone(validReport) as {
			derp: { netcheck?: unknown; netcheck_err?: string };
		};
		delete withoutProbe.derp.netcheck;
		withoutProbe.derp.netcheck_err = "probe failed";

		const report = parseNetcheckReport(JSON.stringify(withoutProbe));
		expect(report.derp.netcheck).toBeUndefined();
		expect(report.derp.netcheck_err).toBe("probe failed");
	});

	it("preserves warning codes and messages", () => {
		const withWarnings = structuredClone(validReport) as {
			derp: { severity: string; warnings: unknown[] };
		};
		withWarnings.derp.severity = "warning";
		withWarnings.derp.warnings = [
			{ code: "EDERP01", message: "Region latency is high" },
		];

		const report = parseNetcheckReport(JSON.stringify(withWarnings));
		expect(report.derp.warnings).toEqual([
			{ code: "EDERP01", message: "Region latency is high" },
		]);
	});

	it("throws ZodError when a required field is missing", () => {
		const missingSeverity = structuredClone(validReport) as {
			derp: { severity?: string };
		};
		delete missingSeverity.derp.severity;
		expect(() => parseNetcheckReport(JSON.stringify(missingSeverity))).toThrow(
			ZodError,
		);
	});

	it("throws ZodError when a field has the wrong type", () => {
		const wrongType = structuredClone(validReport) as {
			derp: { netcheck: { UDP: unknown } };
		};
		wrongType.derp.netcheck.UDP = "yes";
		expect(() => parseNetcheckReport(JSON.stringify(wrongType))).toThrow(
			ZodError,
		);
	});

	it("throws SyntaxError on malformed JSON", () => {
		expect(() => parseNetcheckReport("not json")).toThrow(SyntaxError);
	});
});
