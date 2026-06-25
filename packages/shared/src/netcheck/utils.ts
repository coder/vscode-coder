import type { NetcheckReport, NetcheckSeverity } from "./types";

const SEVERITY_RANK = {
	ok: 0,
	warning: 1,
	error: 2,
} as const satisfies Record<NetcheckSeverity, number>;

/** Worst of the given severities. */
export function worstSeverity(
	severities: readonly NetcheckSeverity[],
): NetcheckSeverity {
	return severities.reduce<NetcheckSeverity>(
		(worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst),
		"ok",
	);
}

/** Worst of the two section severities (errors are folded in at parse). */
export function overallNetcheckSeverity(
	report: NetcheckReport,
): NetcheckSeverity {
	return worstSeverity([report.derp.severity, report.interfaces.severity]);
}
