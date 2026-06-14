import type { NetcheckReport, NetcheckSeverity } from "./types";

const SEVERITY_RANK = {
	ok: 0,
	warning: 1,
	error: 2,
} as const satisfies Record<NetcheckSeverity, number>;

/** Worst severity across the DERP and interfaces sections. */
export function overallNetcheckSeverity(
	report: NetcheckReport,
): NetcheckSeverity {
	const { derp, interfaces } = report;
	return SEVERITY_RANK[derp.severity] >= SEVERITY_RANK[interfaces.severity]
		? derp.severity
		: interfaces.severity;
}
