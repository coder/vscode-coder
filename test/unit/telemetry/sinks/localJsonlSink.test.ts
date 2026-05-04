import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from "vitest";

import {
	LocalJsonlSink,
	type LocalJsonlConfig,
	type LocalJsonlSinkOptions,
} from "@/telemetry/sinks/localJsonlSink";

import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../../mocks/testHelpers";

import type * as fs from "node:fs";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

const SETTING_NAME = "coder.telemetry.localJsonl";
const BASE_DIR = "/telemetry";
const SESSION_ID = "12345678-aaaa-bbbb-cccc-dddddddddddd";
const SESSION_SLUG = "12345678";
const OTHER_SLUG = "ffeeddcc";

// Effectively-disabled interval so tests that don't drive timers themselves
// never see the flush timer fire.
const TEST_CONFIG: Partial<LocalJsonlConfig> = {
	flushIntervalMs: 1_000_000,
};

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

function fileFor(date: string, slug = SESSION_SLUG, segment = 0): string {
	const seg = segment > 0 ? `.${segment}` : "";
	return `${BASE_DIR}/telemetry-${date}-${slug}${seg}.jsonl`;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
	const raw = vol.readFileSync(filePath, "utf8") as string;
	return raw
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function setMtimeAgo(filePath: string, ageMs: number): void {
	const t = (Date.now() - ageMs) / 1000;
	vol.utimesSync(filePath, t, t);
}

describe("LocalJsonlSink", () => {
	let sinks: LocalJsonlSink[];
	let nextSeq: () => number;
	let configProvider: MockConfigurationProvider;

	function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
		const seq = nextSeq();
		return {
			eventId: `id-${seq}`,
			eventName: "test.event",
			timestamp: "2026-05-04T12:00:00.000Z",
			eventSequence: seq,
			context: {
				extensionVersion: "1.14.5",
				machineId: "machine-id",
				sessionId: "session-id",
				osType: "linux",
				osVersion: "6.0.0",
				hostArch: "x64",
				platformName: "Visual Studio Code",
				platformVersion: "1.106.0",
				deploymentUrl: "https://coder.example.com",
			},
			properties: {},
			measurements: {},
			...overrides,
		};
	}

	function makeSink(
		config: Partial<LocalJsonlConfig> = {},
		opts: Partial<LocalJsonlSinkOptions> = {},
	): {
		sink: LocalJsonlSink;
		logger: ReturnType<typeof createMockLogger>;
	} {
		configProvider.set(SETTING_NAME, { ...TEST_CONFIG, ...config });
		const logger = createMockLogger();
		const sink = LocalJsonlSink.start(
			{ baseDir: BASE_DIR, sessionId: SESSION_ID, ...opts },
			logger,
		);
		sinks.push(sink);
		return { sink, logger };
	}

	function todaysFile(slug = SESSION_SLUG, segment = 0): string {
		return fileFor(todayUtc(), slug, segment);
	}

	beforeEach(() => {
		vi.restoreAllMocks();
		vol.reset();
		let counter = 0;
		nextSeq = () => counter++;
		sinks = [];
		configProvider = new MockConfigurationProvider();
	});

	afterEach(async () => {
		for (const s of sinks) {
			await s.dispose();
		}
		vi.useRealTimers();
		vol.reset();
	});

	it("flushes the buffer when the interval fires", async () => {
		vi.useFakeTimers();
		const { sink } = makeSink({ flushIntervalMs: 1000 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		await vi.advanceTimersByTimeAsync(1000);
		expect(readJsonl(todaysFile())).toHaveLength(2);
	});

	it("flushes early once the buffer reaches flushBatchSize", async () => {
		const { sink } = makeSink({ flushBatchSize: 3 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		sink.write(makeEvent());
		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readJsonl(todaysFile())).toHaveLength(3);
	});

	it("drops oldest events and warns once when the buffer exceeds bufferLimit", async () => {
		const { sink, logger } = makeSink({
			bufferLimit: 5,
			flushBatchSize: 10_000,
		});

		for (let i = 0; i < 8; i++) {
			sink.write(makeEvent());
		}
		await sink.flush();

		const overflows = vi
			.mocked(logger.warn)
			.mock.calls.filter((c) => String(c[0]).includes("buffer overflow"));
		expect(overflows).toHaveLength(1);
		expect(readJsonl(todaysFile()).map((l) => l.event_sequence)).toEqual([
			3, 4, 5, 6, 7,
		]);
	});

	it("flushes pending events on dispose", async () => {
		const { sink } = makeSink();
		sink.write(makeEvent());
		sink.write(makeEvent());

		await sink.dispose();

		expect(readJsonl(todaysFile())).toHaveLength(2);
	});

	it("rotates to a numbered segment once maxFileBytes is exceeded", async () => {
		// A serialized event is around 400 bytes, so 900 holds 2 events but not 3.
		const { sink } = makeSink({ maxFileBytes: 900 });

		for (let i = 0; i < 3; i++) {
			sink.write(makeEvent());
			await sink.flush();
		}

		expect(readJsonl(todaysFile(SESSION_SLUG, 0))).toHaveLength(2);
		expect(readJsonl(todaysFile(SESSION_SLUG, 1))).toHaveLength(1);
	});

	it("starts a fresh file on UTC date rollover", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T23:59:00.000Z"));
		const { sink } = makeSink();

		sink.write(makeEvent());
		await sink.flush();
		expect(readJsonl(fileFor("2026-05-04"))).toHaveLength(1);

		vi.setSystemTime(new Date("2026-05-05T00:01:00.000Z"));
		sink.write(makeEvent());
		await sink.flush();

		expect(readJsonl(fileFor("2026-05-04"))).toHaveLength(1);
		expect(readJsonl(fileFor("2026-05-05"))).toHaveLength(1);
	});

	it("deletes telemetry files older than maxAgeDays at startup", async () => {
		const dayMs = 24 * 60 * 60 * 1000;
		const today = todayUtc();
		vol.fromJSON({
			[`${BASE_DIR}/telemetry-2025-01-01-aaaa1111.jsonl`]: "{}\n",
			[`${BASE_DIR}/telemetry-2025-01-02-aaaa1111.jsonl`]: "{}\n",
			[`${BASE_DIR}/telemetry-${today}-bbbb2222.jsonl`]: "{}\n",
		});
		setMtimeAgo(`${BASE_DIR}/telemetry-2025-01-01-aaaa1111.jsonl`, 60 * dayMs);
		setMtimeAgo(`${BASE_DIR}/telemetry-2025-01-02-aaaa1111.jsonl`, 60 * dayMs);

		makeSink({ maxAgeDays: 30 });

		await vi.waitFor(() => {
			expect(vol.readdirSync(BASE_DIR)).toEqual([
				`telemetry-${today}-bbbb2222.jsonl`,
			]);
		});
	});

	it("trims oldest files when total size exceeds maxTotalBytes", async () => {
		const dayMs = 24 * 60 * 60 * 1000;
		const big = "x".repeat(2000);
		vol.fromJSON({
			[`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`]: big,
		});
		setMtimeAgo(`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`, 5 * dayMs);
		setMtimeAgo(`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`, 4 * dayMs);
		setMtimeAgo(`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`, 3 * dayMs);

		makeSink({ maxAgeDays: 365, maxTotalBytes: 4500 });

		await vi.waitFor(() => {
			expect(vol.readdirSync(BASE_DIR).toSorted()).toEqual([
				"telemetry-2026-04-02-b.jsonl",
				"telemetry-2026-04-03-c.jsonl",
			]);
		});
	});

	it("emits valid snake_case JSONL with optional fields when set, omitting when not", async () => {
		const { sink } = makeSink();

		sink.write(makeEvent()); // no optional fields
		sink.write(
			makeEvent({
				eventName: "remote.connect",
				properties: { result: "success" },
				measurements: { durationMs: 12.5 },
				traceId: "trace-1",
				parentEventId: "parent-1",
				error: { message: "nope", type: "TypeError", code: "E_FAIL" },
			}),
		);
		await sink.dispose();

		const [bare, full] = readJsonl(todaysFile());
		expect(bare).not.toHaveProperty("trace_id");
		expect(bare).not.toHaveProperty("parent_event_id");
		expect(bare).not.toHaveProperty("error");
		expect(full).toMatchObject({
			event_id: expect.any(String),
			event_name: "remote.connect",
			event_sequence: 1,
			trace_id: "trace-1",
			parent_event_id: "parent-1",
			error: { message: "nope", type: "TypeError", code: "E_FAIL" },
			context: {
				extension_version: "1.14.5",
				deployment_url: "https://coder.example.com",
				platform_name: "Visual Studio Code",
			},
			properties: { result: "success" },
			measurements: { durationMs: 12.5 },
		});
	});

	it("logs but does not throw when fs.appendFile rejects", async () => {
		const { sink } = makeSink();
		vi.spyOn(fsPromises, "appendFile").mockRejectedValueOnce(new Error("boom"));

		sink.write(makeEvent());
		await expect(sink.flush()).resolves.toBeUndefined();

		// Sink keeps working after a failure.
		sink.write(makeEvent());
		await sink.flush();
		expect(readJsonl(todaysFile())).toHaveLength(1);
	});

	it("two sinks with different sessions write to disjoint files without corruption", async () => {
		const { sink: a } = makeSink();
		const { sink: b } = makeSink(
			{},
			{ sessionId: "ffeeddcc-1111-2222-3333-444444444444" },
		);

		for (let i = 0; i < 5; i++) {
			a.write(makeEvent());
			b.write(makeEvent());
		}
		await Promise.all([a.flush(), b.flush()]);

		expect(readJsonl(todaysFile(SESSION_SLUG))).toHaveLength(5);
		expect(readJsonl(todaysFile(OTHER_SLUG))).toHaveLength(5);
	});

	it("coalesces concurrent flush requests into at most two appendFile calls", async () => {
		const { sink } = makeSink();

		let resolveFirst!: () => void;
		const firstAppendDone = new Promise<void>((r) => {
			resolveFirst = r;
		});
		const realAppend: typeof fsPromises.appendFile =
			fsPromises.appendFile.bind(fsPromises);
		const spy: MockInstance<typeof fsPromises.appendFile> = vi
			.spyOn(fsPromises, "appendFile")
			.mockImplementationOnce(async (target, data, opts) => {
				await firstAppendDone;
				return realAppend(target, data, opts);
			});

		sink.write(makeEvent());
		const p1 = sink.flush();
		// Yield so doFlush #1 captures the buffer and reaches `await appendFile`.
		await Promise.resolve();
		await Promise.resolve();

		sink.write(makeEvent());
		const p2 = sink.flush();
		const p3 = sink.flush();
		expect(p3).toBe(p2);

		resolveFirst();
		await Promise.all([p1, p2, p3]);

		expect(spy).toHaveBeenCalledTimes(2);
		expect(readJsonl(todaysFile()).map((l) => l.event_sequence)).toEqual([
			0, 1,
		]);
	});

	it("picks up config changes reactively", async () => {
		const { sink } = makeSink({ flushBatchSize: 100 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		// Lower the batch threshold; the next write should flush.
		configProvider.set(SETTING_NAME, { ...TEST_CONFIG, flushBatchSize: 3 });
		sink.write(makeEvent());

		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readJsonl(todaysFile())).toHaveLength(3);
	});

	it("write() does not throw when an event cannot be serialized", async () => {
		const { sink } = makeSink();
		const bad = makeEvent();
		(bad.properties as Record<string, unknown>).circular = BigInt(1);

		expect(() => sink.write(bad)).not.toThrow();

		// Sink remains usable for valid events.
		sink.write(makeEvent());
		await sink.flush();
		expect(readJsonl(todaysFile())).toHaveLength(1);
	});
});
