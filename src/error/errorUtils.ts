import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors";
import util from "node:util";

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

/**
 * Convert any value into an Error instance.
 * Handles Error instances, strings, error-like objects, null/undefined, and primitives.
 */
export function toError(value: unknown, defaultMsg?: string): Error {
	if (value instanceof Error) {
		return value;
	}

	if (typeof value === "string") {
		return new Error(value);
	}

	if (
		value !== null &&
		typeof value === "object" &&
		"message" in value &&
		typeof value.message === "string"
	) {
		const error = new Error(value.message);
		if ("name" in value && typeof value.name === "string") {
			error.name = value.name;
		}
		return error;
	}

	if (value === null || value === undefined) {
		return new Error(defaultMsg || "Unknown error");
	}

	try {
		return new Error(util.inspect(value));
	} catch {
		// Just in case
		return new Error(defaultMsg || "Non-serializable error object");
	}
}
