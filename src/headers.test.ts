import * as os from "os";
import { it, expect, describe, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceConfiguration } from "vscode";
import { getHeaderArgs, getHeaderCommand, getHeaders } from "./headers";
import { createMockOutputChannelWithLogger } from "./test-helpers";

const logger = {
	writeToCoderOutputChannel() {
		// no-op
	},
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
	).rejects.toMatch(/Malformed/);
	await expect(
		getHeaders("localhost", "printf '\\r\\nfoo=bar'", logger),
	).rejects.toMatch(/Malformed/);
	await expect(
		getHeaders("localhost", "printf '=foo'", logger),
	).rejects.toMatch(/Malformed/);
	await expect(getHeaders("localhost", "printf 'foo'", logger)).rejects.toMatch(
		/Malformed/,
	);
	await expect(
		getHeaders("localhost", "printf '  =foo'", logger),
	).rejects.toMatch(/Malformed/);
	await expect(
		getHeaders("localhost", "printf 'foo  =bar'", logger),
	).rejects.toMatch(/Malformed/);
	await expect(
		getHeaders("localhost", "printf 'foo  foo=bar'", logger),
	).rejects.toMatch(/Malformed/);
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
	await expect(getHeaders("localhost", "exit 10", logger)).rejects.toMatch(
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

describe("getHeaderArgs", () => {
	beforeEach(() => {
		vi.stubEnv("CODER_HEADER_COMMAND", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("should return empty array when no header command is set", () => {
		const config = {
			get: () => undefined,
		} as unknown as WorkspaceConfiguration;

		expect(getHeaderArgs(config)).toEqual([]);
	});

	it("should return escaped header args with simple command", () => {
		const config = {
			get: () => "printf test",
		} as unknown as WorkspaceConfiguration;

		const result = getHeaderArgs(config);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe("--header-command");
		expect(result[1]).toContain("printf test");
	});

	it("should handle commands with special characters", () => {
		const config = {
			get: () => "echo 'hello world'",
		} as unknown as WorkspaceConfiguration;

		const result = getHeaderArgs(config);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe("--header-command");
		// The escaping will vary by platform but should contain the command
		expect(result[1]).toContain("hello world");
	});
});

describe("Logger integration", () => {
	it("should log errors through Logger when header command fails", async () => {
		const { mockOutputChannel, logger: realLogger } =
			createMockOutputChannelWithLogger();

		// Use the backward compatibility method
		const loggerWrapper = {
			writeToCoderOutputChannel: (msg: string) =>
				realLogger.writeToCoderOutputChannel(msg),
		};

		// Test with a failing command
		await expect(
			getHeaders("localhost", "exit 42", loggerWrapper),
		).rejects.toThrow("Header command exited unexpectedly with code 42");

		// Verify error was logged through Logger
		const logs = realLogger.getLogs();
		expect(logs).toHaveLength(3); // Main error + stdout + stderr

		const logMessages = logs.map((log) => log.message);
		expect(logMessages[0]).toBe(
			"Header command exited unexpectedly with code 42",
		);
		expect(logMessages[1]).toContain("stdout:");
		expect(logMessages[2]).toContain("stderr:");

		// Verify output channel received formatted messages
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringMatching(
				/\[.*\] \[INFO\] Header command exited unexpectedly with code 42/,
			),
		);
	});

	it("should work with Storage instance that has Logger set", async () => {
		const { logger: realLogger } = createMockOutputChannelWithLogger();

		// Simulate Storage with Logger
		const mockStorage = {
			writeToCoderOutputChannel: (msg: string) => {
				realLogger.info(msg);
			},
		};

		// Test with a failing command
		await expect(
			getHeaders("localhost", "command-not-found", mockStorage),
		).rejects.toThrow(/Header command exited unexpectedly/);

		// Verify error was logged
		const logs = realLogger.getLogs();
		expect(logs.length).toBeGreaterThan(0);

		// At least the main error should be logged
		const hasMainError = logs.some((log) =>
			log.message.includes("Header command exited unexpectedly"),
		);
		expect(hasMainError).toBe(true);
	});
});
