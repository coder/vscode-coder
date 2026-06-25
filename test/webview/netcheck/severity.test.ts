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
});
