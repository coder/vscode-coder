import { describe, expect, it, vi } from "vitest";

import { BufferingLogger, type LogLevelSource } from "@/logging/logBuffer";

import type { Logger } from "@/logging/logger";

// Numeric levels matching vscode.LogLevel.
const OFF = 0;
const DEBUG = 2;
const INFO = 3;
const WARNING = 4;
const ERROR = 5;

interface Call {
	level: keyof Logger;
	message: string;
	args: unknown[];
}

function recordingLogger(): { logger: Logger; calls: Call[] } {
	const calls: Call[] = [];
	const push =
		(level: keyof Logger) =>
		(message: string, ...args: unknown[]) =>
			calls.push({ level, message, args });
	return {
		calls,
		logger: {
			trace: push("trace"),
			debug: push("debug"),
			info: push("info"),
			warn: push("warn"),
			error: push("error"),
			show: vi.fn(),
		},
	};
}

function fakeLevelSource(initial: number): LogLevelSource & {
	set(level: number): void;
} {
	let level = initial;
	const listeners = new Set<(level: number) => void>();
	return {
		getLogLevel: () => level,
		onDidChangeLogLevel: (listener) => {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		set(next: number) {
			level = next;
			for (const listener of listeners) {
				listener(next);
			}
		},
	};
}

function clock(start = 1_000): {
	now: () => number;
	advance(ms: number): void;
} {
	let t = start;
	return { now: () => t, advance: (ms) => (t += ms) };
}

describe("BufferingLogger", () => {
	it("forwards every call to the inner logger", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 10);

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

	it("buffers only entries below the current level and replays them on flush", () => {
		const { logger, calls } = recordingLogger();
		const time = clock();
		const buffer = new BufferingLogger(
			logger,
			fakeLevelSource(INFO),
			10,
			5_000,
			time.now,
		);

		buffer.debug("hidden debug");
		buffer.info("visible info");

		calls.length = 0; // ignore the pass-through calls
		buffer.flush("test_reason");

		const replayed = calls.filter((c) => c.message.includes("[buffered]"));
		// header + one debug line + footer; the info line was at level and not buffered.
		expect(replayed).toHaveLength(3);
		expect(replayed[0].message).toContain("connection failure (test_reason)");
		expect(replayed[1].message).toContain("DEBUG hidden debug");
		expect(replayed[2].message).toContain("end of buffered logs");
	});

	it("does not buffer entries at or above the current level", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 10);

		buffer.info("i");
		buffer.warn("w");
		buffer.error("e");

		calls.length = 0;
		buffer.flush("r");

		expect(calls).toHaveLength(0);
	});

	it("evicts the oldest entry when capacity is exceeded", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 2);

		buffer.debug("one");
		buffer.debug("two");
		buffer.debug("three");

		calls.length = 0;
		buffer.flush("r");

		const lines = calls.map((c) => c.message);
		expect(lines.some((l) => l.includes("one"))).toBe(false);
		expect(lines.some((l) => l.includes("two"))).toBe(true);
		expect(lines.some((l) => l.includes("three"))).toBe(true);
	});

	it("clears the buffer after a flush", () => {
		const { logger, calls } = recordingLogger();
		const time = clock();
		const buffer = new BufferingLogger(
			logger,
			fakeLevelSource(INFO),
			10,
			5_000,
			time.now,
		);

		buffer.debug("d");
		buffer.flush("first");
		time.advance(10_000); // past the suppression window

		calls.length = 0;
		buffer.flush("second");

		expect(calls).toHaveLength(0);
	});

	it("is a no-op when the buffer is empty", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 10);

		buffer.flush("r");

		expect(calls).toHaveLength(0);
	});

	it("suppresses a second flush within the suppression window", () => {
		const { logger, calls } = recordingLogger();
		const time = clock();
		const buffer = new BufferingLogger(
			logger,
			fakeLevelSource(INFO),
			10,
			5_000,
			time.now,
		);

		buffer.debug("a");
		buffer.flush("first");

		time.advance(1_000); // within the window
		buffer.debug("b");
		calls.length = 0;
		buffer.flush("second");

		expect(calls).toHaveLength(0);
	});

	it("re-evaluates what is below level when the level changes", () => {
		const { logger, calls } = recordingLogger();
		const level = fakeLevelSource(ERROR);
		const buffer = new BufferingLogger(logger, level, 10);

		buffer.info("info at error level"); // below ERROR -> buffered
		level.set(INFO);
		buffer.info("info at info level"); // at INFO -> not buffered

		calls.length = 0;
		buffer.flush("r");

		const lines = calls.map((c) => c.message);
		expect(lines.some((l) => l.includes("info at error level"))).toBe(true);
		expect(lines.some((l) => l.includes("info at info level"))).toBe(false);
	});

	it("buffers nothing when capacity is zero", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 0);

		buffer.debug("d");
		calls.length = 0;
		buffer.flush("r");

		expect(calls).toHaveLength(0);
	});

	it("keeps the most recent entries when shrunk via setCapacity", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 10);

		buffer.debug("one");
		buffer.debug("two");
		buffer.debug("three");
		buffer.setCapacity(1);

		calls.length = 0;
		buffer.flush("r");

		const lines = calls.map((c) => c.message);
		expect(lines.some((l) => l.includes("three"))).toBe(true);
		expect(lines.some((l) => l.includes("one"))).toBe(false);
		expect(lines.some((l) => l.includes("two"))).toBe(false);
	});

	it.each([
		{ level: INFO, expected: "info" as const },
		{ level: WARNING, expected: "warn" as const },
		{ level: ERROR, expected: "error" as const },
	])(
		"replays at $expected so the flush is written at level $level",
		({ level, expected }) => {
			const { logger, calls } = recordingLogger();
			const buffer = new BufferingLogger(logger, fakeLevelSource(level), 10);

			// Always below the current level so it is buffered.
			buffer.trace("below");
			calls.length = 0;
			buffer.flush("r");

			expect(calls.length).toBeGreaterThan(0);
			expect(calls.every((c) => c.level === expected)).toBe(true);
		},
	);

	it("preserves extra args on replay", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(INFO), 10);
		const detail = { code: 1006 };

		buffer.debug("dropped", detail);
		calls.length = 0;
		buffer.flush("r");

		const line = calls.find((c) => c.message.includes("dropped"));
		expect(line?.args).toEqual([detail]);
	});

	it("stops buffering after dispose unsubscribes from level changes", () => {
		const { logger } = recordingLogger();
		const level = fakeLevelSource(INFO);
		const buffer = new BufferingLogger(logger, level, 10);

		buffer.dispose();
		// Changing the level must not throw or affect the disposed buffer.
		expect(() => level.set(ERROR)).not.toThrow();
	});

	it("does not buffer at the Off level", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(OFF), 10);

		buffer.trace("t");
		buffer.debug("d");
		calls.length = 0;
		buffer.flush("r");

		expect(calls).toHaveLength(0);
	});

	it("buffers trace but not debug at the Debug level", () => {
		const { logger, calls } = recordingLogger();
		const buffer = new BufferingLogger(logger, fakeLevelSource(DEBUG), 10);

		buffer.trace("trace line");
		buffer.debug("debug line");
		calls.length = 0;
		buffer.flush("r");

		const lines = calls.map((c) => c.message);
		expect(lines.some((l) => l.includes("trace line"))).toBe(true);
		expect(lines.some((l) => l.includes("debug line"))).toBe(false);
	});
});
