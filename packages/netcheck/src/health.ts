import type {
	NetcheckReport,
	NetcheckSectionHealth,
	NetcheckSeverity,
} from "@repo/shared";

export interface Issue {
	kind: "error" | "warning";
	code?: string;
	message: string;
}

const SEVERITY_LABEL = {
	ok: "Healthy",
	warning: "Warning",
	error: "Error",
} as const satisfies Record<NetcheckSeverity, string>;

const BANNER_TITLE = {
	ok: "Network is healthy",
	warning: "Network has warnings",
	error: "Network problems detected",
} as const satisfies Record<NetcheckSeverity, string>;

const SECTION_STATUS = {
	ok: "healthy",
	warning: "warning",
	error: "error",
} as const satisfies Record<NetcheckSeverity, string>;

export function severityLabel(severity: NetcheckSeverity): string {
	return SEVERITY_LABEL[severity];
}

export function bannerTitle(severity: NetcheckSeverity): string {
	return BANNER_TITLE[severity];
}

/** One-line status for a report section, e.g. "2 warnings" or "healthy". */
export function sectionSummary(section: NetcheckSectionHealth): string {
	const count = section.warnings.length;
	if (section.severity === "warning" && count > 0) {
		return `${count} warning${count === 1 ? "" : "s"}`;
	}
	return SECTION_STATUS[section.severity];
}

/** Section errors first, then warnings, so the most severe issues lead. */
export function collectIssues(report: NetcheckReport): Issue[] {
	const errors: Issue[] = [];
	const warnings: Issue[] = [];
	const addSection = (section: NetcheckSectionHealth) => {
		if (section.error) {
			errors.push({ kind: "error", message: section.error });
		}
		for (const warning of section.warnings) {
			warnings.push({
				kind: "warning",
				message: warning.message,
				...(warning.code ? { code: warning.code } : {}),
			});
		}
	};
	addSection(report.derp);
	if (report.derp.netcheck_err) {
		errors.push({ kind: "error", message: report.derp.netcheck_err });
	}
	addSection(report.interfaces);
	return [...errors, ...warnings];
}
