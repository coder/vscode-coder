import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors";
import { ErrorEvent } from "eventsource";
import util from "node:util";

import { toError as baseToError } from "@repo/shared";

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

/** Wrap `cause` as `Failed to <verb> <target>: <cause.message>`, preserving the chain. */
export function wrapError(verb: string, target: string, cause: unknown): Error {
	return new Error(`Failed to ${verb} ${target}: ${toError(cause).message}`, {
		cause,
	});
}

/**
 * Convert various error types to readable strings
 */
export function errToStr(error: unknown, def = "No error message provided") {
	if (error instanceof Error && error.message) {
		return error.message;
	} else if (isApiError(error)) {
		return error.response.data.message;
	} else if (isApiErrorResponse(error)) {
		return error.message;
	} else if (error instanceof ErrorEvent) {
		const message = error.message || def;
		return error.code ? `${error.code}: ${message}` : message;
	} else if (typeof error === "string" && error.trim().length > 0) {
		return error;
	}
	return def;
}

/** Like `errToStr`, but keeps the server's detail and field errors. */
export function describeError(error: unknown): string {
	if (!isApiError(error)) {
		return errToStr(error);
	}
	const { message, detail, validations = [] } = error.response.data;
	return [message, detail, ...validations.map((v) => `${v.field}: ${v.detail}`)]
		.filter(Boolean)
		.join("\n");
}
