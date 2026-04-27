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
			platformType: "Visual Studio Code",
			platformVersion: "1.106.0-test",
		});
	});

	it("derives os/host fields from process and os", () => {
		const ctx = buildContext(fakeContext());
		expect(ctx.hostArch).toBe(process.arch);
		expect(ctx.osType).toBe(
			process.platform === "win32" ? "windows" : process.platform,
		);
		expect(ctx.osVersion).toBeTruthy();
	});

	it("preserves the raw vscode.env.appName so we keep granularity", () => {
		env.appName = "Visual Studio Code - Insiders";
		expect(buildContext(fakeContext()).platformType).toBe(
			"Visual Studio Code - Insiders",
		);
		env.appName = "Cursor";
		expect(buildContext(fakeContext()).platformType).toBe("Cursor");
	});

	it("uses the 'unknown' sentinel when packageJSON.version is missing or non-string", () => {
		const noVersion = {
			extension: { packageJSON: {} },
		} as unknown as vscodeTypes.ExtensionContext;
		expect(buildContext(noVersion).extensionVersion).toBe("unknown");
		expect(buildContext(fakeContext(123)).extensionVersion).toBe("unknown");
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
