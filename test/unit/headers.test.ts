import * as os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WorkspaceConfiguration } from "vscode";

import { getHeaderCommand, getHeaders } from "@/headers";
import { type Logger } from "@/logging/logger";

const logger: Logger = {
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

it("should return no headers", async () => {
	await expect(getHeaders(undefined, undefined, logger)).resolves.toStrictEqual(
		{},
	);
	await expect(
		getHeaders("localhost", undefined, logger),
	).resolves.toStrictEqual({});
	await expect(getHeaders(undefined, "command", logger)).resolves.toStrictEqual(
		{},
	);
	await expect(getHeaders("localhost", "", logger)).resolves.toStrictEqual({});
	await expect(getHeaders("", "command", logger)).resolves.toStrictEqual({});
	await expect(getHeaders("localhost", "  ", logger)).resolves.toStrictEqual(
		{},
	);
	await expect(getHeaders("  ", "command", logger)).resolves.toStrictEqual({});
	await expect(
		getHeaders("localhost", "printf ''", logger),
	).resolves.toStrictEqual({});
});

it("should return headers", async () => {
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\nbaz=qux'", logger),
	).resolves.toStrictEqual({
		foo: "bar",
		baz: "qux",
	});
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\nbaz=qux'", logger),
	).resolves.toStrictEqual({
		foo: "bar",
		baz: "qux",
	});
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\n'", logger),
	).resolves.toStrictEqual({ foo: "bar" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar'", logger),
	).resolves.toStrictEqual({ foo: "bar" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar='", logger),
	).resolves.toStrictEqual({ foo: "bar=" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar=baz'", logger),
	).resolves.toStrictEqual({ foo: "bar=baz" });
	await expect(
		getHeaders("localhost", "printf 'foo='", logger),
	).resolves.toStrictEqual({ foo: "" });
});

it("should error on malformed or empty lines", async () => {
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\n\\r\\n'", logger),
	).rejects.toThrow(/Malformed/);
	await expect(
		getHeaders("localhost", "printf '\\r\\nfoo=bar'", logger),
	).rejects.toThrow(/Malformed/);
	await expect(
		getHeaders("localhost", "printf '=foo'", logger),
	).rejects.toThrow(/Malformed/);
	await expect(getHeaders("localhost", "printf 'foo'", logger)).rejects.toThrow(
		/Malformed/,
	);
	await expect(
		getHeaders("localhost", "printf '  =foo'", logger),
	).rejects.toThrow(/Malformed/);
	await expect(
		getHeaders("localhost", "printf 'foo  =bar'", logger),
	).rejects.toThrow(/Malformed/);
	await expect(
		getHeaders("localhost", "printf 'foo  foo=bar'", logger),
	).rejects.toThrow(/Malformed/);
});

it("should have access to environment variables", async () => {
	const coderUrl = "dev.coder.com";
	await expect(
		getHeaders(
			coderUrl,
			os.platform() === "win32"
				? "printf url=%CODER_URL%"
				: "printf url=$CODER_URL",
			logger,
		),
	).resolves.toStrictEqual({ url: coderUrl });
});

it("should error on non-zero exit", async () => {
	await expect(getHeaders("localhost", "exit 10", logger)).rejects.toThrow(
		/exited unexpectedly with code 10/,
	);
});

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
