import { describe, expect, it } from "vitest";

import { buildErrorBlock, buildSession } from "@/telemetry/event";

import type * as vscode from "vscode";

function fakeContext(version: unknown = "1.2.3-test"): vscode.ExtensionContext {
	return {
		extension: { packageJSON: { version } },
	} as unknown as vscode.ExtensionContext;
}

describe("buildSession", () => {
	it("populates session-stable fields from the extension context, vscode env, and host", () => {
		const session = buildSession(fakeContext());

		expect(session).toMatchObject({
			extensionVersion: "1.2.3-test",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			platformType: "Visual Studio Code",
			platformVersion: "1.106.0-test",
			hostArch: process.arch,
		});
		expect(session.osType).toBe(
			process.platform === "win32" ? "windows" : process.platform,
		);
		expect(session.osVersion).toBeTruthy();
	});

	it("uses the 'unknown' sentinel when packageJSON.version is missing or non-string", () => {
		const noVersion = {
			extension: { packageJSON: {} },
		} as unknown as vscode.ExtensionContext;
		expect(buildSession(noVersion).extensionVersion).toBe("unknown");
		expect(buildSession(fakeContext(123)).extensionVersion).toBe("unknown");
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
