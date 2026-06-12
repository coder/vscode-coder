import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stream } = vi.hoisted(() => ({
	stream: {
		chunks: [] as string[],
		writeFailMsg: null as string | null,
		endFailMsg: null as string | null,
		destroyed: 0,
		listeners: new Map<string, (err: Error) => void>(),
		write(chunk: string, _enc: string, cb: (err?: Error | null) => void) {
			if (stream.writeFailMsg) {
				cb(new Error(stream.writeFailMsg));
				return;
			}
			stream.chunks.push(chunk);
			cb(null);
		},
		end(cb: (err?: Error | null) => void) {
			if (stream.endFailMsg) {
				cb(new Error(stream.endFailMsg));
				return;
			}
			cb(null);
		},
		destroy() {
			stream.destroyed += 1;
		},
		once(event: string, listener: (err: Error) => void) {
			stream.listeners.set(event, listener);
			return stream;
		},
		emit(event: string, err: Error) {
			stream.listeners.get(event)?.(err);
		},
	},
}));

vi.mock("node:fs", () => ({
	createWriteStream: () => stream,
}));

const { openEnvelopeFile } =
	await import("@/telemetry/export/writers/otlp/envelope");

beforeEach(() => {
	stream.chunks = [];
	stream.writeFailMsg = null;
	stream.endFailMsg = null;
	stream.destroyed = 0;
	stream.listeners = new Map();
});

afterEach(() => vi.clearAllMocks());

describe("openEnvelopeFile", () => {
	it("writes only the file prefix and suffix when no block is opened", async () => {
		const env = await openEnvelopeFile("/x.json", "PRE", "END", "SUF");
		await env.close();
		expect(stream.chunks.join("")).toBe("PRESUF");
	});

	it("serializes appended values as JSON, comma-separated, inside a block", async () => {
		const env = await openEnvelopeFile("/x.json", "[", "}", "]");
		await env.openBlock("{");
		await env.append({ a: 1 });
		await env.append("two");
		await env.append([3, 4]);
		await env.close();
		expect(stream.chunks.join("")).toBe('[{{"a":1},"two",[3,4]}]');
	});

	it("inserts commas between values but not before the first", async () => {
		const env = await openEnvelopeFile("/x.json", "[", "}", "]");
		await env.openBlock("{");
		await env.append(1);
		await env.append(2);
		await env.close();
		expect(stream.chunks).toEqual(["[", "{", "1", ",2", "}]"]);
	});

	it("closes the previous block, separates blocks with a comma, and restarts comma separation", async () => {
		const env = await openEnvelopeFile("/x.json", "[", "}", "]");
		await env.openBlock("{");
		await env.append(1);
		await env.openBlock("{");
		await env.append(2);
		await env.append(3);
		await env.close();
		expect(stream.chunks).toEqual(["[", "{", "1", "},{", "2", ",3", "}]"]);
	});

	it("rejects appends when no block is open", async () => {
		const env = await openEnvelopeFile("/x.json", "[", "}", "]");
		await expect(env.append(1)).rejects.toThrow(
			"No open block to append to in /x.json",
		);
	});

	it("wraps prefix-write failures with the file path and releases the fd", async () => {
		stream.writeFailMsg = "disk full";
		await expect(openEnvelopeFile("/foo.json", "[", "}", "]")).rejects.toThrow(
			"Failed to write /foo.json: disk full",
		);
		expect(stream.destroyed).toBe(1);
	});

	it("wraps block-open write failures with the file path", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		stream.writeFailMsg = "disk full";
		await expect(env.openBlock("{")).rejects.toThrow(
			"Failed to write /foo.json: disk full",
		);
	});

	it("wraps append-time write failures with the file path", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		await env.openBlock("{");
		stream.writeFailMsg = "disk full";
		await expect(env.append({ a: 1 })).rejects.toThrow(
			"Failed to write /foo.json: disk full",
		);
	});

	it("wraps suffix-write failures during close as a close failure and releases the fd", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		stream.writeFailMsg = "disk full";
		await expect(env.close()).rejects.toThrow(
			"Failed to close /foo.json: disk full",
		);
		expect(stream.destroyed).toBe(1);
	});

	it("wraps stream.end failures with the file path and releases the fd", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		stream.endFailMsg = "stream gone";
		await expect(env.close()).rejects.toThrow(
			"Failed to close /foo.json: stream gone",
		);
		expect(stream.destroyed).toBe(1);
	});

	it("rejects subsequent writes after the stream emits 'error'", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		await env.openBlock("{");
		stream.emit("error", new Error("ENOENT"));
		await expect(env.append({ a: 1 })).rejects.toThrow(
			"Failed to write /foo.json: ENOENT",
		);
	});

	it("is idempotent: calling close() twice is safe", async () => {
		const env = await openEnvelopeFile("/foo.json", "[", "}", "]");
		await env.close();
		// Second close is a no-op and does not double-write the suffix.
		await env.close();
		expect(stream.chunks).toEqual(["[", "]"]);
	});
});
