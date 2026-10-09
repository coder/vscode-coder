/** Convert any thrown value into an Error. Pass `serialize` (e.g. `util.inspect`
 *  in Node) for richer object formatting; the default `JSON.stringify` will
 *  throw on circular inputs and fall through to `defaultMsg`. */
export function toError(
	value: unknown,
	defaultMsg?: string,
	serialize: (value: unknown) => string = JSON.stringify,
): Error {
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
		return new Error(defaultMsg ?? "Unknown error");
	}

	try {
		return new Error(serialize(value));
	} catch {
		return new Error(defaultMsg ?? "Non-serializable error object");
	}
}
