import type {
	NetcheckHealthMessage,
	NetcheckReport,
	NetcheckSectionHealth,
	NetcheckSeverity,
} from "@repo/shared";

export interface Issue {
	kind: "error" | "warning";
	code?: string;
	message: string;
}

const SEVERITY_LABEL: Record<NetcheckSeverity, string> = {
	ok: "Healthy",
	warning: "Warning",
	error: "Error",
};

export function severityLabel(severity: NetcheckSeverity): string {
	return SEVERITY_LABEL[severity];
}

const BANNER_TITLE: Record<NetcheckSeverity, string> = {
	ok: "Network is healthy",
	warning: "Network has warnings",
	error: "Network problems detected",
};

export function bannerTitle(severity: NetcheckSeverity): string {
	return BANNER_TITLE[severity];
}

/** One-line status for a report section, e.g. "DERP & STUN: 2 warnings". */
export function sectionSummary(
	label: string,
	section: NetcheckSectionHealth,
): string {
	switch (section.severity) {
		case "ok":
			return `${label}: healthy`;
		case "warning": {
			const count = section.warnings.length;
			return count > 0
				? `${label}: ${count} warning${count === 1 ? "" : "s"}`
				: `${label}: warning`;
		}
		case "error":
			return `${label}: error`;
	}
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
			warnings.push({ kind: "warning", ...toIssueParts(warning) });
		}
	};
	addSection(report.derp);
	if (report.derp.netcheck_err) {
		errors.push({ kind: "error", message: report.derp.netcheck_err });
	}
	addSection(report.interfaces);
	return [...errors, ...warnings];
}

function toIssueParts(warning: NetcheckHealthMessage): {
	code?: string;
	message: string;
} {
	return warning.code
		? { code: warning.code, message: warning.message }
		: { message: warning.message };
}
