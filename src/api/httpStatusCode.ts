/** HTTP status codes the extension branches on. */
export const HttpStatusCode = {
	OK: 200,
	NOT_MODIFIED: 304,
	BAD_REQUEST: 400,
	/** Authentication required */
	UNAUTHORIZED: 401,
	/** Permission denied */
	FORBIDDEN: 403,
	/** Endpoint not found */
	NOT_FOUND: 404,
	CONFLICT: 409,
	/** Resource permanently gone */
	GONE: 410,
	/** Protocol upgrade required */
	UPGRADE_REQUIRED: 426,
	INTERNAL_SERVER_ERROR: 500,
} as const;
