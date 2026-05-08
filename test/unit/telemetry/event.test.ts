import { describe, expect, it } from "vitest";

import {
	buildErrorBlock,
	buildSession,
	extractExtensionVersion,
} from "@/telemetry/event";

describe("buildSession", () => {
	it("populates session-stable fields from the version, sessionId, vscode env, and host", () => {
		const session = buildSession("1.2.3-test", "session-abc");

		expect(session).toMatchObject({
			extensionVersion: "1.2.3-test",
			machineId: "test-machine-id",
			sessionId: "session-abc",
			platformName: "Visual Studio Code",
			platformVersion: "1.106.0-test",
			hostArch: process.arch,
		});
		expect(session.osType).toBe(
			process.platform === "win32" ? "windows" : process.platform,
		);
		expect(session.osVersion).toBeTruthy();
	});
});

describe("extractExtensionVersion", () => {
	it("returns the version when packageJSON.version is a string", () => {
		expect(extractExtensionVersion({ version: "4.5.6" })).toBe("4.5.6");
	});

	it("falls back to 'unknown' when packageJSON is missing, malformed, or non-string", () => {
		expect(extractExtensionVersion({})).toBe("unknown");
		expect(extractExtensionVersion({ version: 123 })).toBe("unknown");
		expect(extractExtensionVersion(null)).toBe("unknown");
		expect(extractExtensionVersion(undefined)).toBe("unknown");
	});
});

describe("buildErrorBlock", () => {
	it.each([
		[
			"Error instance",
			new TypeError("nope"),
			{ message: "nope", type: "TypeError" },
		],
		["string", "boom", { message: "boom" }],
		[
			"plain object with message + name",
			{ message: "hi", name: "Custom" },
			{ message: "hi", type: "Custom" },
		],
		["null", null, { message: "Unknown error" }],
	])("normalizes %s", (_label, input, expected) => {
		expect(buildErrorBlock(input)).toEqual(expected);
	});

	it("captures Node-style and HTTP-style codes as strings", () => {
		expect(
			buildErrorBlock(
				Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }),
			).code,
		).toBe("ECONNREFUSED");
		expect(
			buildErrorBlock(Object.assign(new Error("bad"), { code: 401 })).code,
		).toBe("401");
	});

	it("omits type for generic Error instances", () => {
		expect(buildErrorBlock(new Error("plain"))).toEqual({ message: "plain" });
	});
});
