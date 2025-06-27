import { it, expect } from "vitest";
import { getHeaders } from "./headers";

const logger = {
	writeToCoderOutputChannel() {
		// no-op
	},
};

it("should return no headers when invalid input", async () => {
	await expect(getHeaders(undefined, undefined, logger)).resolves.toStrictEqual(
		{},
	);
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

it("should error on malformed headers", async () => {
	await expect(
		getHeaders("localhost", "printf 'foo=bar\\r\\n\\r\\n'", logger),
	).rejects.toMatch(/Malformed/);
});
