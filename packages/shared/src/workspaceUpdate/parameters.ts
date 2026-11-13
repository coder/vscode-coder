import type { DynamicParametersResponse } from "coder/site/src/api/typesGenerated";

export function hasErrorDiagnostics({
	parameters,
	diagnostics,
}: DynamicParametersResponse): boolean {
	return [...diagnostics, ...parameters.flatMap((p) => p.diagnostics)].some(
		(d) => d.severity === "error",
	);
}

/** Multi-select values are stored as a JSON-encoded string array. */
export function parseMultiSelectValue(raw: string): string[] | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
			? parsed
			: null;
	} catch {
		return null;
	}
}
