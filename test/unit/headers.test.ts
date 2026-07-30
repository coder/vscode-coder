import { describe, expect, it } from "vitest";

import { getHeaders } from "@/headers";

import { createMockLogger } from "../mocks/testHelpers";
import { printCommand, exitCommand, printEnvCommand } from "../utils/platform";

const logger = createMockLogger();

describe("Headers", () => {
	it("should return no headers", async () => {
		await expect(
			getHeaders(undefined, undefined, logger),
		).resolves.toStrictEqual({});
		await expect(
			getHeaders("localhost", undefined, logger),
		).resolves.toStrictEqual({});
		await expect(
			getHeaders(undefined, "command", logger),
		).resolves.toStrictEqual({});
		await expect(getHeaders("localhost", "", logger)).resolves.toStrictEqual(
			{},
		);
		await expect(getHeaders("", "command", logger)).resolves.toStrictEqual({});
		await expect(getHeaders("localhost", "  ", logger)).resolves.toStrictEqual(
			{},
		);
		await expect(getHeaders("  ", "command", logger)).resolves.toStrictEqual(
			{},
		);
		await expect(
			getHeaders("localhost", printCommand(""), logger),
		).resolves.toStrictEqual({});
	});

	it("should return headers", async () => {
		await expect(
			getHeaders("localhost", printCommand("foo=bar\nbaz=qux"), logger),
		).resolves.toStrictEqual({
			foo: "bar",
			baz: "qux",
		});
		await expect(
			getHeaders("localhost", printCommand("foo=bar\r\nbaz=qux"), logger),
		).resolves.toStrictEqual({
			foo: "bar",
			baz: "qux",
		});
		await expect(
			getHeaders("localhost", printCommand("foo=bar\r\n"), logger),
		).resolves.toStrictEqual({ foo: "bar" });
		await expect(
			getHeaders("localhost", printCommand("foo=bar"), logger),
		).resolves.toStrictEqual({ foo: "bar" });
		await expect(
			getHeaders("localhost", printCommand("foo=bar="), logger),
		).resolves.toStrictEqual({ foo: "bar=" });
		await expect(
			getHeaders("localhost", printCommand("foo=bar=baz"), logger),
		).resolves.toStrictEqual({ foo: "bar=baz" });
		await expect(
			getHeaders("localhost", printCommand("foo="), logger),
		).resolves.toStrictEqual({ foo: "" });
	});

	it("should error on malformed or empty lines", async () => {
		await expect(
			getHeaders("localhost", printCommand("foo=bar\r\n\r\n"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("\r\nfoo=bar"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("=foo"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("foo"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("  =foo"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("foo  =bar"), logger),
		).rejects.toThrow(/Malformed/);
		await expect(
			getHeaders("localhost", printCommand("foo  foo=bar"), logger),
		).rejects.toThrow(/Malformed/);
	});

	it("should not include command output in parse errors", async () => {
		const command = printCommand("Authorization=Bearer SECRET-VALUE\nbad line");
		const error = await getHeaders("localhost", command, logger).then(
			() => {
				throw new Error("expected getHeaders to reject");
			},
			(e: Error) => e,
		);
		expect(error.message).toMatch(/Malformed line 2/);
		expect(error.message).not.toContain("SECRET-VALUE");
		expect(error.message).not.toContain("Authorization");
		expect(error.message).not.toContain("bad line");
	});

	it("should have access to environment variables", async () => {
		const coderUrl = "dev.coder.com";
		await expect(
			getHeaders(coderUrl, printEnvCommand("url", "CODER_URL"), logger),
		).resolves.toStrictEqual({ url: coderUrl });
	});

	it("should error on non-zero exit", async () => {
		await expect(
			getHeaders("localhost", exitCommand(10), logger),
		).rejects.toThrow(/exited unexpectedly with code 10/);
	});
});
