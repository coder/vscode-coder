import { describe, expect, it } from "vitest";

import { createRequestId, shortId } from "@/logging/ids";

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

describe("createRequestId", () => {
	it("generates valid UUID format without dashes", () => {
		const id = createRequestId();
		expect(id).toHaveLength(32);
		expect(id).not.toContain("-");
	});
});
