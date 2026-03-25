import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHeaderCommand } from "@/settings/headers";

import type { WorkspaceConfiguration } from "vscode";

describe("getHeaderCommand", () => {
	beforeEach(() => {
		vi.stubEnv("CODER_HEADER_COMMAND", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("should return undefined if coder.headerCommand is not set in config", () => {
		const config = {
			get: () => undefined,
		} as unknown as WorkspaceConfiguration;

		expect(getHeaderCommand(config)).toBeUndefined();
	});

	it("should return undefined if coder.headerCommand is a blank string", () => {
		const config = {
			get: () => "   ",
		} as unknown as WorkspaceConfiguration;

		expect(getHeaderCommand(config)).toBeUndefined();
	});

	it("should return coder.headerCommand if set in config", () => {
		vi.stubEnv("CODER_HEADER_COMMAND", "printf 'x=y'");

		const config = {
			get: () => "printf 'foo=bar'",
		} as unknown as WorkspaceConfiguration;

		expect(getHeaderCommand(config)).toBe("printf 'foo=bar'");
	});

	it("should return CODER_HEADER_COMMAND if coder.headerCommand is not set in config and CODER_HEADER_COMMAND is set in environment", () => {
		vi.stubEnv("CODER_HEADER_COMMAND", "printf 'x=y'");

		const config = {
			get: () => undefined,
		} as unknown as WorkspaceConfiguration;

		expect(getHeaderCommand(config)).toBe("printf 'x=y'");
	});
});
