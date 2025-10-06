import { describe, expect, it } from "vitest";

import {
	formatBody,
	formatHeaders,
	formatMethod,
	formatSize,
	formatTime,
	formatUri,
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

		it("redacts sensitive headers", () => {
			const sensitiveHeaders = ["Coder-Session-Token", "Proxy-Authorization"];

			sensitiveHeaders.forEach((header) => {
				const result = formatHeaders({ [header]: "secret-value" });
				expect(result).toContain(`${header}: <redacted>`);
				expect(result).not.toContain("secret-value");
			});
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
	});
});
