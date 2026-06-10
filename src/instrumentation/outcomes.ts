import { isAbortError } from "../error/errorUtils";

import type { Span } from "../telemetry/span";

export type AbortableFailureCategory = "aborted" | "error";

/** Records a categorized failure without attaching raw error details. */
export function recordFailure(span: Span, category: string): void {
	span.setProperty("failure_category", category);
	span.markFailure();
}

/** Records the stage at which the user backed out and aborts the span. */
export function recordCancelled(span: Span, stage: string): void {
	span.setProperty("cancel_stage", stage);
	span.markAborted();
}

export function categorizeAbortableFailure(
	error: unknown,
): AbortableFailureCategory {
	return isAbortError(error) ? "aborted" : "error";
}
