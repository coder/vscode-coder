import type { NetcheckReport, NetcheckSeverity } from "./types";

const SEVERITY_RANK = {
	ok: 0,
	warning: 1,
	error: 2,
} as const satisfies Record<NetcheckSeverity, number>;

/**
 * Worst severity across the report. A failed probe (`netcheck_err`) or section
 * error counts as an error even when the section severity wasn't raised, so the
 * banner agrees with the Issues list.
 */
export function overallNetcheckSeverity(
	report: NetcheckReport,
): NetcheckSeverity {
	const { derp, interfaces } = report;
	if (derp.netcheck_err || derp.error || interfaces.error) {
		return "error";
	}
	return SEVERITY_RANK[derp.severity] >= SEVERITY_RANK[interfaces.severity]
		? derp.severity
		: interfaces.severity;
}
