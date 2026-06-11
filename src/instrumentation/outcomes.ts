import { isAbortError } from "../error/errorUtils";

import type { Span } from "../telemetry/span";

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

/** Marks a thrown abort as `aborted`; records anything else as a categorized `"error"`. */
export function recordAbortableError(span: Span, error: unknown): void {
	if (isAbortError(error)) {
		span.markAborted();
	} else {
		recordError(span, "error");
	}
}
