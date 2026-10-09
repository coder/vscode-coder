import { describe, expect, it } from "vitest";

import {
	formatBody,
	formatHeaders,
	formatMethod,
	formatSize,
	formatTime,
	formatUri,
	safeStringify,
	sizeOf,
} from "@/logging/formatters";

describe("Logging formatters", () => {
	it("formats time in appropriate units", () => {
		expect(formatTime(500)).toBe("500ms");
		expect(formatTime(1000)).toBe("1.00s");
		expect(formatTime(5500)).toBe("5.50s");
		expect(formatTime(60000)).toBe("1.00m");
		expect(formatTime(150000)).toBe("2.50m");
		expect(formatTime(3600000)).toBe("1.00h");
		expect(formatTime(7255000)).toBe("2.02h");
	});

	describe("formatMethod", () => {
		it("normalizes HTTP methods to uppercase", () => {
			expect(formatMethod("get")).toBe("GET");
			expect(formatMethod("post")).toBe("POST");
			expect(formatMethod("PUT")).toBe("PUT");
			expect(formatMethod("delete")).toBe("DELETE");
		});

		it("defaults to GET for falsy values", () => {
			expect(formatMethod(undefined)).toBe("GET");
			expect(formatMethod("")).toBe("GET");
		});
	});

	describe("formatSize", () => {
		it("formats byte sizes using pretty-bytes", () => {
			expect(formatSize(1024)).toContain("1.02 kB");
			expect(formatSize(0)).toBe("(0 B)");
		});

		it("returns placeholder for undefined", () => {
			expect(formatSize(undefined)).toBe("(? B)");
		});
	});

	describe("formatUri", () => {
		it("returns URL when present", () => {
			expect(formatUri({ url: "https://example.com/api" })).toBe(
				"https://example.com/api",
			);
			expect(formatUri({ url: "/relative/path" })).toBe("/relative/path");
		});

		it("returns placeholder for missing URL", () => {
			expect(formatUri(undefined)).toContain("no url");
			expect(formatUri({})).toContain("no url");
			expect(formatUri({ url: "" })).toContain("no url");
		});
	});

	describe("formatHeaders", () => {
		it("formats headers as key-value pairs", () => {
			const headers = {
				"content-type": "application/json",
				accept: "text/html",
			};
			const result = formatHeaders(headers);
			expect(result).toContain("content-type: application/json");
			expect(result).toContain("accept: text/html");
		});

		it("redacts sensitive headers regardless of casing", () => {
			const sensitiveHeaders = [
				"authorization",
				"AUTHORIZATION",
				"Coder-Session-Token",
				"coder-session-token",
				"cookie",
				"set-cookie",
				"SET-COOKIE",
				"X-Api-Key",
				"Proxy-Authorization",
			];

			sensitiveHeaders.forEach((header) => {
				const result = formatHeaders({ [header]: "secret-value" });
				expect(result).toContain(`${header}: <redacted>`);
				expect(result).not.toContain("secret-value");
			});
		});

		it("redacts extra header names case-insensitively", () => {
			const result = formatHeaders(
				{ "X-Custom-Auth": "secret-value", accept: "text/html" },
				["x-custom-auth"],
			);
			expect(result).toContain("X-Custom-Auth: <redacted>");
			expect(result).not.toContain("secret-value");
			expect(result).toContain("accept: text/html");
		});

		it("returns placeholder for empty headers", () => {
			expect(formatHeaders({})).toBe("<no headers>");
		});
	});

	describe("formatBody", () => {
		it("formats various body types", () => {
			expect(formatBody({ key: "value" })).toContain("key: 'value'");
			expect(formatBody("plain text")).toContain("plain text");
			expect(formatBody([1, 2, 3])).toContain("1");
			expect(formatBody(123)).toContain("123");
			expect(formatBody(true)).toContain("true");
		});

		it("handles circular references gracefully", () => {
			const circular: Record<string, unknown> = { a: 1 };
			circular.self = circular;
			const result = formatBody(circular);
			expect(result).toBeTruthy();
			expect(result).not.toContain("invalid body");
			expect(result).toContain("a: 1");
		});

		it("handles deep nesting", () => {
			const deep = {
				level1: { level2: { level3: { level4: { value: "deep" } } } },
			};
			const result = formatBody(deep);
			expect(result).toContain("level4: { value: 'deep' }");
		});

		it("returns placeholder for empty values", () => {
			const emptyValues = [null, undefined, "", 0, false];
			emptyValues.forEach((value) => {
				expect(formatBody(value)).toContain("no body");
			});
		});

		it("redacts sensitive fields in objects", () => {
			const result = formatBody({
				access_token: "secret-access",
				refresh_token: "secret-refresh",
				registration_access_token: "secret-registration",
				client_secret: "secret-client",
				code: "secret-code",
				code_verifier: "secret-verifier",
				id_token: "secret-id",
				password: "secret-password",
				token: "secret-token",
				token_type: "bearer",
			});
			expect(result).toContain("access_token: '<redacted>'");
			expect(result).toContain("registration_access_token: '<redacted>'");
			expect(result).toContain("token_type: 'bearer'");
			expect(result).not.toContain("secret-");
		});

		it("redacts sensitive fields in nested objects and arrays", () => {
			const result = formatBody({
				data: { session: { TOKEN: "secret-value" } },
				items: [{ password: "secret-value" }],
			});
			expect(result).toContain("TOKEN: '<redacted>'");
			expect(result).toContain("password: '<redacted>'");
			expect(result).not.toContain("secret-value");
		});

		it("redacts sensitive fields in URLSearchParams", () => {
			const params = new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: "secret-value",
			});
			const result = formatBody(params);
			expect(result).toContain("refresh_token");
			expect(result).toContain("<redacted>");
			expect(result).not.toContain("secret-value");
		});

		it("redacts sensitive fields in serialized bodies", () => {
			const json = formatBody(
				JSON.stringify({ access_token: "secret-value", expires_in: 3600 }),
			);
			expect(json).toContain("expires_in");
			expect(json).not.toContain("secret-value");

			const form = formatBody(
				"grant_type=authorization_code&code=secret-value",
			);
			expect(form).toContain("grant_type");
			expect(form).not.toContain("secret-value");
		});

		it("leaves non-sensitive strings unchanged", () => {
			expect(formatBody("plain response text")).toContain(
				"plain response text",
			);
			expect(formatBody("a=b&c=d")).toContain("a=b&c=d");
		});
	});
});

describe("sizeOf", () => {
	type SizeOfTestCase = [data: unknown, bytes: number | undefined];
	it.each<SizeOfTestCase>([
		// Primitives return a fixed value
		[null, 0],
		[undefined, 0],
		[42, 8],
		[3.14, 8],
		[false, 4],
		// Strings
		["hello", 5],
		["✓", 3],
		["unicode: ✓", 12],
		// Buffers
		[Buffer.from("test"), 4],
		[BigInt(12345), 5],
		[BigInt(0), 1],
		[Buffer.alloc(100), 100],
		[Buffer.from([]), 0],
		// Typed-arrays
		[new ArrayBuffer(50), 50],
		[new Uint8Array([1, 2, 3, 4]), 4],
		[new Int32Array([1, 2, 3]), 12],
		[new Float64Array([1.0, 2.0]), 16],
		// Objects/untyped-arrays return undefined
		[{ size: 1024 }, 1024],
		[{ size: 0 }, 0],
		[{ size: "not a number" }, undefined],
		[[], undefined],
		[[1, 2, 3], undefined],
		[["a", "b", "c"], undefined],
		[{}, undefined],
		[{ foo: "bar" }, undefined],
		[{ nested: { value: 123 } }, undefined],
	])("returns size for %s", (data: unknown, bytes: number | undefined) => {
		expect(sizeOf(data)).toBe(bytes);
	});

	it("handles circular references safely", () => {
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;
		expect(sizeOf(circular)).toBeUndefined();

		const arr: unknown[] = [1, 2, 3];
		arr.push(arr);
		expect(sizeOf(arr)).toBeUndefined();
	});
});

describe("safeStringify", () => {
	it("formats various data types", () => {
		expect(safeStringify({ key: "value" })).toContain("key: 'value'");
		expect(safeStringify("plain text")).toContain("plain text");
		expect(safeStringify([1, 2, 3])).toContain("1");
		expect(safeStringify(123)).toContain("123");
		expect(safeStringify(true)).toContain("true");
	});

	it("handles circular references safely", () => {
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;
		const result = safeStringify(circular);
		expect(result).toBeTruthy();
		expect(result).toContain("a: 1");
	});

	it("handles deep nesting", () => {
		const deep = {
			level1: { level2: { level3: { level4: { value: "deep" } } } },
		};
		const result = safeStringify(deep);
		expect(result).toContain("level4: { value: 'deep' }");
	});

	it("bounds output size for large inputs", () => {
		const longString = safeStringify("a".repeat(50_000));
		expect(longString?.length).toBeLessThan(20_000);

		const bigArray = safeStringify(Array.from({ length: 10_000 }, (_, i) => i));
		expect(bigArray).toContain("more items");

		let nested: Record<string, unknown> = { value: "bottom" };
		for (let i = 0; i < 30; i++) {
			nested = { child: nested };
		}
		expect(safeStringify(nested)).not.toContain("bottom");
	});
});
