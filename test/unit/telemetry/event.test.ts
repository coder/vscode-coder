import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { buildContext, buildErrorBlock } from "@/telemetry/event";

import type * as vscodeTypes from "vscode";

function fakeContext(
	version: unknown = "1.2.3-test",
): vscodeTypes.ExtensionContext {
	return {
		extension: { packageJSON: { version } },
	} as unknown as vscodeTypes.ExtensionContext;
}

describe("buildContext", () => {
	const env = vscode.env as { appName: string };
	const originalAppName = env.appName;
	afterEach(() => {
		env.appName = originalAppName;
	});

	it("populates session-stable fields from the extension context and vscode env", () => {
		expect(buildContext(fakeContext())).toMatchObject({
			extensionVersion: "1.2.3-test",
			machineId: "test-machine-id",
			sessionId: "test-session-id",
			deploymentUrl: "",
			platformType: "vscode",
			platformVersion: "1.106.0-test",
		});
	});

	it("returns truthy values for runtime os/host fields", () => {
		const ctx = buildContext(fakeContext());
		expect(ctx.osType).toBeTruthy();
		expect(ctx.osVersion).toBeTruthy();
		expect(ctx.hostArch).toBeTruthy();
	});

	it.each([
		["Cursor", "cursor"],
		["VSCodium", "vscodium"],
		["Visual Studio Code", "vscode"],
		["Some Unknown Fork", "vscode"],
	])("derives platformType %s -> %s", (appName, expected) => {
		env.appName = appName;
		expect(buildContext(fakeContext()).platformType).toBe(expected);
	});

	it("falls back to empty string when packageJSON.version is missing or not a string", () => {
		const noVersion = {
			extension: { packageJSON: {} },
		} as unknown as vscodeTypes.ExtensionContext;
		expect(buildContext(noVersion).extensionVersion).toBe("");
		expect(buildContext(fakeContext(123)).extensionVersion).toBe("");
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

	it("captures Node-style error.code as a string", () => {
		expect(
			buildErrorBlock(
				Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }),
			),
		).toEqual({ message: "connect failed", code: "ECONNREFUSED" });
	});

	it("stringifies numeric codes (HTTP status)", () => {
		expect(
			buildErrorBlock(Object.assign(new Error("bad"), { code: 401 })).code,
		).toBe("401");
	});

	it("omits type for generic Error instances", () => {
		expect(buildErrorBlock(new Error("plain"))).toEqual({ message: "plain" });
	});
});
