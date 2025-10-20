import { describe, expect, it } from "vitest";

import {
	createRequestId,
	safeStringify,
	shortId,
	sizeOf,
} from "@/logging/utils";

describe("Logging utils", () => {
	describe("shortId", () => {
		it("truncates long strings to 8 characters", () => {
			expect(shortId("abcdefghijklmnop")).toBe("abcdefgh");
			expect(shortId("12345678")).toBe("12345678");
			expect(shortId("123456789")).toBe("12345678");
		});

		it("returns short strings unchanged", () => {
			expect(shortId("short")).toBe("short");
			expect(shortId("")).toBe("");
			expect(shortId("1234567")).toBe("1234567");
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
	});

	describe("createRequestId", () => {
		it("generates valid UUID format without dashes", () => {
			const id = createRequestId();
			expect(id).toHaveLength(32);
			expect(id).not.toContain("-");
		});
	});
});
