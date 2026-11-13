import { ValidationMessage } from "@repo/ui";

import type { FriendlyDiagnostic } from "coder/site/src/api/typesGenerated";

function diagnosticText({ summary, detail }: FriendlyDiagnostic) {
	return detail ? `${summary}: ${detail}` : summary;
}

/** Messages under a field, read through the control's `aria-describedby`. */
export function FieldDiagnostics({
	diagnostics,
}: {
	diagnostics: readonly FriendlyDiagnostic[];
}) {
	return diagnostics.map((diagnostic) => (
		<ValidationMessage
			key={`${diagnostic.summary}:${diagnostic.detail}`}
			severity={diagnostic.severity}
		>
			{diagnosticText(diagnostic)}
		</ValidationMessage>
	));
}

/** Messages about the whole form, announced as they appear. */
export function FormDiagnostics({
	diagnostics,
}: {
	diagnostics: readonly FriendlyDiagnostic[];
}) {
	return diagnostics.map((diagnostic) => (
		<ValidationMessage
			key={`${diagnostic.summary}:${diagnostic.detail}`}
			role={diagnostic.severity === "error" ? "alert" : "status"}
			severity={diagnostic.severity}
		>
			{diagnosticText(diagnostic)}
		</ValidationMessage>
	));
}
