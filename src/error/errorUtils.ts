import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors";
import util from "node:util";

import { toError as baseToError } from "@repo/shared";

/** Check whether an unknown thrown value is an AbortError (signal cancellation). */
export function isAbortError(error: unknown): error is Error {
	return error instanceof Error && error.name === "AbortError";
}

// getErrorDetail is copied from coder/site, but changes the default return.
export const getErrorDetail = (error: unknown): string | undefined | null => {
	if (isApiError(error)) {
		return error.response.data.detail;
	}
	if (isApiErrorResponse(error)) {
		return error.detail;
	}
	return null;
};

/** Node flavor of toError: uses `util.inspect` for the richer object format. */
export function toError(value: unknown, defaultMsg?: string): Error {
	return baseToError(value, defaultMsg, util.inspect);
}
