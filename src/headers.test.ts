import * as os from "os";
import {
	it,
	expect,
	describe,
	beforeEach,
	afterEach,
	vi,
	beforeAll,
} from "vitest";
import { WorkspaceConfiguration } from "vscode";
import { getHeaderCommand, getHeaders } from "./headers";

// Mock vscode module before importing anything that uses logger
beforeAll(() => {
	vi.mock("vscode", () => {
		return {
			workspace: {
				getConfiguration: vi.fn().mockReturnValue({
					get: vi.fn().mockReturnValue(false),
				}),
				onDidChangeConfiguration: vi.fn().mockReturnValue({
					dispose: vi.fn(),
				}),
			},
		};
	});
});

it("should return no headers", async () => {
	await expect(getHeaders(undefined, undefined)).resolves.toStrictEqual({});
	await expect(getHeaders("localhost", undefined)).resolves.toStrictEqual({});
	await expect(getHeaders(undefined, "command")).resolves.toStrictEqual({});
	await expect(getHeaders("localhost", "")).resolves.toStrictEqual({});
	await expect(getHeaders("", "command")).resolves.toStrictEqual({});
	await expect(getHeaders("localhost", "  ")).resolves.toStrictEqual({});
	await expect(getHeaders("  ", "command")).resolves.toStrictEqual({});
	await expect(getHeaders("localhost", "printf ''")).resolves.toStrictEqual({});
});

it("should return headers", async () => {
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\nbaz=qux'"),
	).resolves.toStrictEqual({
		foo: "bar",
		baz: "qux",
	});
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\nbaz=qux'"),
	).resolves.toStrictEqual({
		foo: "bar",
		baz: "qux",
	});
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\n'"),
	).resolves.toStrictEqual({ foo: "bar" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar'"),
	).resolves.toStrictEqual({ foo: "bar" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar='"),
	).resolves.toStrictEqual({ foo: "bar=" });
	await expect(
		getHeaders("localhost", "printf 'foo=bar=baz'"),
	).resolves.toStrictEqual({ foo: "bar=baz" });
	await expect(getHeaders("localhost", "printf 'foo='")).resolves.toStrictEqual(
		{ foo: "" },
	);
});

it("should error on malformed or empty lines", async () => {
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\n\\r\\n'"),
	).rejects.toThrowError(/Malformed/);
	await expect(
		getHeaders("localhost", "printf '\\r\\nfoo=bar'"),
	).rejects.toThrowError(/Malformed/);
	await expect(getHeaders("localhost", "printf '=foo'")).rejects.toThrowError(
		/Malformed/,
	);
	await expect(getHeaders("localhost", "printf 'foo'")).rejects.toThrowError(
		/Malformed/,
	);
	await expect(getHeaders("localhost", "printf '  =foo'")).rejects.toThrowError(
		/Malformed/,
	);
	await expect(
		getHeaders("localhost", "printf 'foo  =bar'"),
	).rejects.toThrowError(/Malformed/);
	await expect(
		getHeaders("localhost", "printf 'foo  foo=bar'"),
	).rejects.toThrowError(/Malformed/);
});

it("should have access to environment variables", async () => {
	const coderUrl = "dev.coder.com";
	await expect(
		getHeaders(
			coderUrl,
			os.platform() === "win32"
				? "printf url=%CODER_URL%"
				: "printf url=$CODER_URL",
		),
	).resolves.toStrictEqual({ url: coderUrl });
});

it("should error on non-zero exit", async () => {
	await expect(getHeaders("localhost", "exit 10")).rejects.toThrowError(
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

	it("should return undefined if coder.headerCommand is not a string", () => {
		const config = {
			get: () => 1234,
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
