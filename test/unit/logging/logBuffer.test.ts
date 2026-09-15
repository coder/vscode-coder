import { afterEach, describe, expect, it, vi } from "vitest";

import { BufferingLogger } from "@/logging/logBuffer";

import type { Logger } from "@/logging/logger";

// Numeric levels matching vscode.LogLevel.
const OFF = 0;
const DEBUG = 2;
const INFO = 3;
const WARNING = 4;
const ERROR = 5;

type LogMethod = Exclude<keyof Logger, "show">;

interface Call {
	level: LogMethod;
	message: string;
	args: unknown[];
}

function setup(level: number, capacity: number) {
	const calls: Call[] = [];
	const push =
		(method: LogMethod) =>
		(message: string, ...args: unknown[]) =>
			calls.push({ level: method, message, args });
	const logger: Logger = {
		trace: push("trace"),
		debug: push("debug"),
		info: push("info"),
		warn: push("warn"),
		error: push("error"),
		show: vi.fn(),
	};
	const channel = { logLevel: level };
	const buffer = new BufferingLogger(logger, channel, capacity);
	// Ignore the pass-through calls, then return only what the flush replayed.
	const flush = (reason = "r"): string[] => {
		calls.length = 0;
		buffer.flush(reason);
		return calls.map((c) => c.message);
	};
	return { buffer, calls, channel, flush };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("BufferingLogger", () => {
	it("forwards every call to the inner logger", () => {
		const { buffer, calls } = setup(INFO, 10);

		buffer.trace("t");
		buffer.debug("d");
		buffer.info("i");
		buffer.warn("w");
		buffer.error("e");

		expect(calls.map((c) => c.level)).toEqual([
			"trace",
			"debug",
			"info",
			"warn",
			"error",
		]);
	});

	interface LevelCase {
		level: number;
		hidden: LogMethod;
		shown: LogMethod;
		sink: "info" | "warn" | "error";
	}

	it.each<LevelCase>([
		{
			level: DEBUG,
			hidden: "trace",
			shown: "debug",
			sink: "info",
		},
		{
			level: INFO,
			hidden: "debug",
			shown: "info",
			sink: "info",
		},
		{
			level: WARNING,
			hidden: "info",
			shown: "warn",
			sink: "warn",
		},
		{
			level: ERROR,
			hidden: "warn",
			shown: "error",
			sink: "error",
		},
	])(
		"at level $level buffers below-level entries and replays them via the $sink sink",
		({ level, hidden, shown, sink }) => {
			const { buffer, calls, flush } = setup(level, 10);

			buffer[hidden]("hidden line");
			buffer[shown]("shown line");
			const lines = flush();

			expect(lines.some((l) => l.includes("hidden line"))).toBe(true);
			expect(lines.some((l) => l.includes("shown line"))).toBe(false);
			expect(calls.every((c) => c.level === sink)).toBe(true);
		},
	);

	it("re-evaluates what is below level when the level changes", () => {
		const { buffer, channel, flush } = setup(ERROR, 10);

		buffer.info("info at error level"); // below ERROR -> buffered
		channel.logLevel = INFO;
		buffer.info("info at info level"); // at INFO -> not buffered

		const lines = flush();
		expect(lines.some((l) => l.includes("info at error level"))).toBe(true);
		expect(lines.some((l) => l.includes("info at info level"))).toBe(false);
	});

	interface CapacityCase {
		name: string;
		capacity: number;
		values: string[];
		shrinkTo?: number;
		present: string[];
		absent: string[];
	}

	it.each<CapacityCase>([
		{
			name: "evicts the oldest entry when capacity is exceeded",
			capacity: 2,
			values: ["one", "two", "three"],
			present: ["two", "three"],
			absent: ["one"],
		},
		{
			name: "buffers nothing when capacity is zero",
			capacity: 0,
			values: ["one", "two", "three"],
			present: [],
			absent: ["one", "two", "three"],
		},
		{
			name: "keeps the most recent entries when shrunk via setCapacity",
			capacity: 10,
			values: ["one", "two", "three"],
			shrinkTo: 1,
			present: ["three"],
			absent: ["one", "two"],
		},
		{
			name: "evicts oldest entries once the character budget is exceeded",
			capacity: 100_000,
			values: [
				`first ${"x".repeat(1_200_000)}`,
				`second ${"x".repeat(1_200_000)}`,
			],
			present: ["second "],
			absent: ["first "],
		},
	])("$name", ({ capacity, values, shrinkTo, present, absent }) => {
		const { buffer, flush } = setup(INFO, capacity);

		for (const value of values) {
			buffer.debug(value);
		}
		if (shrinkTo !== undefined) {
			buffer.setCapacity(shrinkTo);
		}

		const lines = flush();
		for (const value of present) {
			expect(lines.some((l) => l.includes(value))).toBe(true);
		}
		for (const value of absent) {
			expect(lines.some((l) => l.includes(value))).toBe(false);
		}
	});

	it("replays each entry with its record time, args, and a [buffered] prefix on every line", () => {
		const recordedAt = Date.parse("2024-01-01T00:00:00.000Z");
		vi.spyOn(Date, "now").mockReturnValueOnce(recordedAt);
		const { buffer, calls, flush } = setup(INFO, 10);
		const detail = { code: 1006 };

		buffer.debug("first line\nsecond line", detail);
		const lines = flush();

		expect(lines[0]).toContain("connection failure (r)");
		expect(lines[lines.length - 1]).toContain("end of buffered logs");

		const entry = calls.find((c) => c.message.includes("first line"));
		expect(entry).toBeDefined();
		expect(entry?.message).toContain("2024-01-01T00:00:00.000Z");
		expect(entry?.message).toContain("DEBUG first line");
		// Args are formatted into the text at record time, not passed through.
		expect(entry?.message).toContain("1006");
		expect(entry?.args).toEqual([]);
	});

	it("clears after flush, no-ops when empty, and preserves entries flushed while Off", () => {
		const { buffer, channel, flush } = setup(INFO, 10);

		// Empty flush is a no-op.
		expect(flush()).toHaveLength(0);

		// Each failure only replays entries accumulated since the previous one.
		buffer.debug("before first");
		expect(flush("first").some((l) => l.includes("before first"))).toBe(true);
		buffer.debug("before second");
		const second = flush("second");
		expect(second.some((l) => l.includes("before second"))).toBe(true);
		expect(second.some((l) => l.includes("before first"))).toBe(false);

		// Nothing is buffered while the channel itself is at Off.
		channel.logLevel = OFF;
		buffer.debug("logged while off");
		channel.logLevel = INFO;
		expect(flush("after").some((l) => l.includes("logged while off"))).toBe(
			false,
		);

		// A flush at Off keeps the context buffered until logging returns.
		buffer.debug("buffered before going off");
		channel.logLevel = OFF;
		expect(flush("off")).toHaveLength(0);
		channel.logLevel = INFO;
		expect(
			flush("back").some((l) => l.includes("buffered before going off")),
		).toBe(true);
	});
});
