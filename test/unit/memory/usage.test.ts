import { describe, expect, it } from "vitest";

import { formatUsage } from "@/memory/usage";

const GiB = 1024 ** 3;

describe("formatUsage", () => {
	it.each([
		[6.12 * GiB, 16 * GiB, "6.12/16 GiB"],
		[1.5 * GiB, 2 * GiB, "1.5/2 GiB"],
		[300 * 1024 ** 2, 512 * 1024 ** 2, "300/512 MiB"],
	])("formats %d of %d as %s", (usedBytes, totalBytes, text) => {
		expect(formatUsage({ usedBytes, totalBytes, source: "host" })).toBe(text);
	});
});
