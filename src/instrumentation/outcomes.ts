import { isAbortError } from "../error/errorUtils";

import type { Span } from "../telemetry/span";

export type AbortableErrorCategory = "aborted" | "error";

/** Records a categorized error without attaching the raw error details. */
export function recordError(span: Span, category: string): void {
	span.setProperty("error.type", category);
	span.markError();
}

/** Records the stage at which the user backed out and aborts the span. */
export function recordAborted(span: Span, stage: string): void {
	span.setProperty("abort_stage", stage);
	span.markAborted();
}

export function categorizeAbortableError(
	error: unknown,
): AbortableErrorCategory {
	return isAbortError(error) ? "aborted" : "error";
}
