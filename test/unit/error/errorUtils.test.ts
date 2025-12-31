import { describe, it, expect } from "vitest";

import { getErrorDetail, toError } from "@/error/errorUtils";

describe("getErrorDetail", () => {
	it("returns detail from API error", () => {
		const error = {
			isAxiosError: true,
			response: {
				data: {
					message: "Something went wrong",
					detail: "Database connection failed",
				},
			},
		};
		expect(getErrorDetail(error)).toBe("Database connection failed");
	});

	it("returns detail from API error response", () => {
		const error = {
			message: "Something went wrong",
			detail: "Invalid credentials",
		};
		expect(getErrorDetail(error)).toBe("Invalid credentials");
	});

	type NullCase = [string, unknown];
	it.each<NullCase>([
		["null", null],
		["undefined", undefined],
		["string", "error string"],
	])("returns null for %s", (_name, input) => {
		expect(getErrorDetail(input)).toBeNull();
	});

	type UndefinedCase = [string, unknown];
	it.each<UndefinedCase>([
		["non-API error", new Error("Generic error")],
		["plain object without detail", { message: "No detail here" }],
	])("returns undefined for %s", (_name, input) => {
		expect(getErrorDetail(input)).toBeUndefined();
	});
});

describe("toError", () => {
	it("returns Error instance unchanged", () => {
		const error = new Error("Original error");
		expect(toError(error)).toBe(error);
	});

	it("preserves Error subclass instances", () => {
		const error = new TypeError("Type error");
		expect(toError(error)).toBe(error);
		expect(toError(error)).toBeInstanceOf(TypeError);
	});

	it.each<string>(["Something went wrong", ""])(
		"converts string %j to Error",
		(input) => {
			const result = toError(input);
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe(input);
		},
	);

	it("converts object with message and name properties to Error", () => {
		const result = toError({ message: "Custom error", name: "CustomError" });
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("Custom error");
		expect(result.name).toBe("CustomError");
	});

	it("ignores non-string name property", () => {
		const result = toError({ message: "Error", name: 123 });
		expect(result.message).toBe("Error");
		expect(result.name).toBe("Error");
	});

	it.each([null, undefined])(
		"converts '%s' to Error with default message",
		(input) => {
			const result = toError(input);
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe("Unknown error");
		},
	);

	it.each([null, undefined])(
		"uses custom default message for '%s'",
		(_name, input) => {
			const result = toError(input, "Custom default");
			expect(result.message).toBe("Custom default");
		},
	);

	type PrimitiveCase = [string, unknown, string];
	it.each<PrimitiveCase>([
		["number", 42, "42"],
		["boolean", true, "true"],
	])("converts %s to Error with inspected value", (_name, input, expected) => {
		const result = toError(input);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe(expected);
	});

	it("converts object without message to Error with inspected value", () => {
		const result = toError({ foo: "bar", count: 5 });
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toEqual("{ foo: 'bar', count: 5 }");
	});

	it("converts array to Error with inspected value", () => {
		const result = toError([1, 2, 3]);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toEqual("[ 1, 2, 3 ]");
	});

	it("ignores object with non-string message property", () => {
		const result = toError({ message: 123 });
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toEqual("{ message: 123 }");
	});
});
