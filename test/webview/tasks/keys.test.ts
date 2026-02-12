import { describe, expect, it } from "vitest";

import { isActivate, isEscape, isSubmit } from "@repo/tasks/utils/keys";

describe("isSubmit", () => {
	it("returns true for Enter+ctrlKey", () => {
		expect(isSubmit(key({ key: "Enter", ctrlKey: true }))).toBe(true);
	});

	it("returns true for Enter+metaKey", () => {
		expect(isSubmit(key({ key: "Enter", metaKey: true }))).toBe(true);
	});

	it("returns false for Enter alone", () => {
		expect(isSubmit(key({ key: "Enter" }))).toBe(false);
	});

	it("returns false for non-Enter with ctrlKey", () => {
		expect(isSubmit(key({ key: "a", ctrlKey: true }))).toBe(false);
	});
});

describe("isActivate", () => {
	it("returns true for Enter", () => {
		expect(isActivate(key({ key: "Enter" }))).toBe(true);
	});

	it("returns true for Space", () => {
		expect(isActivate(key({ key: " " }))).toBe(true);
	});

	it("returns false for Escape", () => {
		expect(isActivate(key({ key: "Escape" }))).toBe(false);
	});

	it("returns false for other keys", () => {
		expect(isActivate(key({ key: "a" }))).toBe(false);
	});
});

describe("isEscape", () => {
	it("returns true for Escape", () => {
		expect(isEscape(key({ key: "Escape" }))).toBe(true);
	});

	it("returns false for Enter", () => {
		expect(isEscape(key({ key: "Enter" }))).toBe(false);
	});

	it("returns false for other keys", () => {
		expect(isEscape(key({ key: "a" }))).toBe(false);
	});
});

function key(
	overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean }>,
) {
	return { key: "a", metaKey: false, ctrlKey: false, ...overrides };
}
