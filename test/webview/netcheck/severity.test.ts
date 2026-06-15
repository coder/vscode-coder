import { describe, expect, it } from "vitest";

import { overallNetcheckSeverity } from "@repo/shared";

import { report } from "./fixtures";

describe("overallNetcheckSeverity", () => {
	it("takes the worst of the two section severities", () => {
		expect(overallNetcheckSeverity(report())).toBe("ok");
		expect(
			overallNetcheckSeverity(report({ interfaces: { severity: "warning" } })),
		).toBe("warning");
		expect(
			overallNetcheckSeverity(report({ derp: { severity: "error" } })),
		).toBe("error");
	});

	it("is error when the connectivity probe failed but the section reads ok", () => {
		expect(
			overallNetcheckSeverity(
				report({ derp: { severity: "ok", netcheck_err: "probe failed" } }),
			),
		).toBe("error");
	});

	it("is error when a section carries an error string without raising severity", () => {
		expect(
			overallNetcheckSeverity(
				report({ derp: { severity: "ok", error: "DERP map unreachable" } }),
			),
		).toBe("error");
	});
});
