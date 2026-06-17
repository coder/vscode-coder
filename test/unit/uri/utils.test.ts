import { describe, expect, it } from "vitest";

import { removeTrailingSlashes, toSafeHost } from "@/uri/utils";

describe("toSafeHost", () => {
	it.each([
		["https://foobar:8080", "foobar"],
		["https://ほげ", "xn--18j4d"],
		["https://test.😉.invalid", "test.xn--n28h.invalid"],
		["https://dev.😉-coder.com", "dev.xn---coder-vx74e.com"],
		["http://ignore-port.com:8080", "ignore-port.com"],
	])("returns %s for %s", (input, expected) => {
		expect(toSafeHost(input)).toBe(expected);
	});

	it("throws for invalid URLs", () => {
		expect(() => toSafeHost("invalid url")).toThrow("Invalid URL");
	});
});

describe("removeTrailingSlashes", () => {
	it.each([
		["https://coder.example.com", "https://coder.example.com"],
		["https://coder.example.com/", "https://coder.example.com"],
		["https://coder.example.com///", "https://coder.example.com"],
		["///", ""],
	])("returns %j for %j", (input, expected) => {
		expect(removeTrailingSlashes(input)).toBe(expected);
	});
});
