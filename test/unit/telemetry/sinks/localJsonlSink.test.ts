import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	LOCAL_TELEMETRY_SETTING,
	type LocalSinkConfig,
} from "@/settings/telemetry";
import { LocalJsonlSink } from "@/telemetry/sinks/localJsonlSink";
import {
	serializeTelemetryEventLine,
	serializeTelemetryFileHeaderLine,
	type SessionContext,
} from "@/telemetry/wireFormat";

import {
	createTelemetryEventFactory,
	TEST_SESSION_CONTEXT,
} from "../../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
	setAge,
} from "../../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const BASE_DIR = "/telemetry";
const SESSION_ID = "12345678-aaaa-bbbb-cccc-dddddddddddd";
const SESSION_SLUG = "12345678";

const sessionContext = (sessionId: string): SessionContext => ({
	...TEST_SESSION_CONTEXT,
	sessionId,
});

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const fileFor = (date: string, slug = SESSION_SLUG, segment = 0): string => {
	const seg = segment > 0 ? `.${segment}` : "";
	return `${BASE_DIR}/telemetry-${date}-${slug}${seg}.jsonl`;
};

const todaysFile = (slug?: string, segment?: number): string =>
	fileFor(todayUtc(), slug, segment);

const readJsonl = (filePath: string): Array<Record<string, unknown>> =>
	(vol.readFileSync(filePath, "utf8") as string)
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));

/** Event rows only, with header lines filtered out. */
const readRows = (filePath: string): Array<Record<string, unknown>> =>
	readJsonl(filePath).filter((l) => l.kind === undefined);

const readHeaders = (filePath: string): Array<Record<string, unknown>> =>
	readJsonl(filePath).filter((l) => l.kind === "header");

describe("LocalJsonlSink", () => {
	let active: LocalJsonlSink[];
	let provider: MockConfigurationProvider;

	beforeEach(() => {
		vi.restoreAllMocks();
		vol.reset();
		active = [];
		provider = new MockConfigurationProvider();
	});

	afterEach(async () => {
		for (const s of active) {
			await s.dispose();
		}
		vi.useRealTimers();
		vol.reset();
	});

	function setup(
		config: Partial<LocalSinkConfig> = {},
		sessionId = SESSION_ID,
	) {
		provider.set(LOCAL_TELEMETRY_SETTING, {
			flushIntervalMs: 1_000_000,
			...config,
		});
		const logger = createMockLogger();
		const sink = LocalJsonlSink.start(
			{ baseDir: BASE_DIR, session: sessionContext(sessionId) },
			logger,
		);
		active.push(sink);

		return { sink, logger, makeEvent: createTelemetryEventFactory() };
	}

	it("flushes the buffer when the interval fires", async () => {
		vi.useFakeTimers();
		const { sink, makeEvent } = setup({ flushIntervalMs: 1000 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		await vi.advanceTimersByTimeAsync(1000);
		expect(readRows(todaysFile())).toHaveLength(2);
	});

	it("writes the session header as the first line of a new file", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
		const { sink, makeEvent } = setup();

		sink.write(makeEvent());
		await sink.flush();

		// The header shape itself is locked by the wireFormat tests.
		const [first, ...rest] = readJsonl(todaysFile());
		expect(first).toEqual(
			JSON.parse(serializeTelemetryFileHeaderLine(sessionContext(SESSION_ID))),
		);
		expect(rest).toHaveLength(1);
	});

	it("appends rows without a second header when the file already has bytes", async () => {
		// A prior flush in the same session (simulated on disk) already wrote
		// the header; seeding from disk must not repeat it.
		const priorEvents = createTelemetryEventFactory();
		vol.fromJSON({
			[todaysFile()]:
				serializeTelemetryFileHeaderLine(sessionContext(SESSION_ID)) +
				serializeTelemetryEventLine(priorEvents()),
		});
		const { sink, makeEvent } = setup();

		sink.write(makeEvent());
		await sink.flush();

		expect(readHeaders(todaysFile())).toHaveLength(1);
		expect(readRows(todaysFile())).toHaveLength(2);
		expect(readJsonl(todaysFile())[0].kind).toBe("header");
	});

	it("flushes early once the buffer reaches flushBatchSize", async () => {
		const { sink, makeEvent } = setup({ flushBatchSize: 3 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		sink.write(makeEvent());
		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readRows(todaysFile())).toHaveLength(3);
	});

	it("drops the oldest events when the buffer exceeds bufferLimit", async () => {
		const { sink, makeEvent } = setup({
			bufferLimit: 10,
			flushBatchSize: 10_000,
		});

		for (let i = 0; i < 13; i++) {
			sink.write(makeEvent());
		}
		await sink.flush();

		expect(readRows(todaysFile()).map((l) => l.event_sequence)).toEqual([
			3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("warns when bufferLimit is below flushBatchSize", () => {
		const { logger } = setup({ bufferLimit: 10, flushBatchSize: 100 });

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("bufferLimit"),
		);
	});

	it("emits one overflow warning per burst regardless of flush outcome", async () => {
		const { sink, logger, makeEvent } = setup({
			bufferLimit: 10,
			flushBatchSize: 10_000,
		});
		const overflowBuffer = (): void => {
			for (let i = 0; i < 13; i++) {
				sink.write(makeEvent());
			}
		};

		overflowBuffer();
		await sink.flush();

		vi.spyOn(fsPromises, "appendFile").mockRejectedValueOnce(new Error("boom"));
		overflowBuffer();
		await expect(sink.flush()).rejects.toThrow("boom");

		overflowBuffer();
		await sink.flush();

		const overflowWarnings = vi
			.mocked(logger.warn)
			.mock.calls.filter(
				(c) => typeof c[0] === "string" && c[0].includes("buffer overflow"),
			);
		expect(overflowWarnings).toHaveLength(3);
	});

	it("flushes pending events on dispose", async () => {
		const { sink, makeEvent } = setup();
		sink.write(makeEvent());
		sink.write(makeEvent());

		await sink.dispose();

		expect(readRows(todaysFile())).toHaveLength(2);
	});

	it("ignores writes after dispose", async () => {
		const { sink, makeEvent } = setup();
		sink.write(makeEvent());
		sink.write(makeEvent());
		await sink.dispose();

		sink.write(makeEvent());
		sink.write(makeEvent());

		expect(readRows(todaysFile())).toHaveLength(2);
	});

	it("rotates to a numbered segment once maxFileBytes is exceeded", async () => {
		// ~300B header + ~1700B rows: 4500 holds the header and 2 rows, not 3.
		const { sink, makeEvent } = setup({ maxFileBytes: 4500 });
		const padded = () => makeEvent({ properties: { pad: "x".repeat(1500) } });

		for (let i = 0; i < 3; i++) {
			sink.write(padded());
			await sink.flush();
		}

		expect(readRows(todaysFile(SESSION_SLUG, 0))).toHaveLength(2);
		expect(readRows(todaysFile(SESSION_SLUG, 1))).toHaveLength(1);
		// Every segment is independently readable: each opens with a header.
		expect(readJsonl(todaysFile(SESSION_SLUG, 0))[0].kind).toBe("header");
		expect(readJsonl(todaysFile(SESSION_SLUG, 1))[0].kind).toBe("header");
	});

	it("keeps a single oversized payload in segment 0 instead of rotating", async () => {
		// Single event larger than maxFileBytes. Without the `size > 0`
		// guard, every event would skip segment 0 and start at .1.
		const { sink, makeEvent } = setup({ maxFileBytes: 4096 });

		sink.write(makeEvent({ properties: { huge: "x".repeat(5000) } }));
		await sink.flush();

		expect(readRows(todaysFile(SESSION_SLUG, 0))).toHaveLength(1);
		expect(vol.existsSync(todaysFile(SESSION_SLUG, 1))).toBe(false);
	});

	it("starts a fresh file with its own header on UTC date rollover", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T23:59:00.000Z"));
		const { sink, makeEvent } = setup();

		sink.write(makeEvent());
		await sink.flush();

		vi.setSystemTime(new Date("2026-05-05T00:01:00.000Z"));
		sink.write(makeEvent());
		await sink.flush();

		for (const date of ["2026-05-04", "2026-05-05"]) {
			expect(readRows(fileFor(date))).toHaveLength(1);
			expect(readJsonl(fileFor(date))[0].kind).toBe("header");
		}
	});

	it("deletes telemetry files older than maxAgeDays at startup", async () => {
		const today = todayUtc();
		vol.fromJSON({
			[`${BASE_DIR}/telemetry-2025-01-01-aaaa1111.jsonl`]: "{}\n",
			[`${BASE_DIR}/telemetry-2025-01-02-aaaa1111.jsonl`]: "{}\n",
			[`${BASE_DIR}/telemetry-${today}-bbbb2222.jsonl`]: "{}\n",
		});
		await setAge(`${BASE_DIR}/telemetry-2025-01-01-aaaa1111.jsonl`, 60);
		await setAge(`${BASE_DIR}/telemetry-2025-01-02-aaaa1111.jsonl`, 60);

		setup({ maxAgeDays: 30 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR)).toEqual([
				`telemetry-${today}-bbbb2222.jsonl`,
			]),
		);
	});

	it("trims oldest files when total size exceeds maxTotalBytes", async () => {
		const big = "x".repeat(2000);
		vol.fromJSON({
			[`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`]: big,
		});
		await setAge(`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`, 5);
		await setAge(`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`, 4);
		await setAge(`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`, 3);

		setup({ maxAgeDays: 365, maxTotalBytes: 4500 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR).toSorted()).toEqual([
				"telemetry-2026-04-02-b.jsonl",
				"telemetry-2026-04-03-c.jsonl",
			]),
		);
	});

	it("keeps deleting until total size is under maxTotalBytes", async () => {
		const big = "x".repeat(3000);
		vol.fromJSON({
			[`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`]: big,
			[`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`]: big,
		});
		await setAge(`${BASE_DIR}/telemetry-2026-04-01-a.jsonl`, 5);
		await setAge(`${BASE_DIR}/telemetry-2026-04-02-b.jsonl`, 4);
		await setAge(`${BASE_DIR}/telemetry-2026-04-03-c.jsonl`, 3);

		setup({ maxAgeDays: 365, maxTotalBytes: 5000 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR)).toEqual([
				"telemetry-2026-04-03-c.jsonl",
			]),
		);
	});

	it("emits valid snake_case JSONL rows with optional fields when set, omitting when not", async () => {
		const { sink, makeEvent } = setup();

		sink.write(makeEvent());
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

		const [bare, full] = readRows(todaysFile());
		expect(bare).not.toHaveProperty("trace_id");
		expect(bare).not.toHaveProperty("parent_event_id");
		expect(bare).not.toHaveProperty("error");
		expect(bare).not.toHaveProperty("context");
		expect(full).toMatchObject({
			event_id: expect.any(String),
			event_name: "remote.connect",
			event_sequence: 1,
			trace_id: "trace-1",
			parent_event_id: "parent-1",
			error: { message: "nope", type: "TypeError", code: "E_FAIL" },
			deployment_url: "https://coder.example.com",
			properties: { result: "success" },
			measurements: { durationMs: 12.5 },
		});
	});

	it("rejects when fs.appendFile fails, and recovers on the next flush", async () => {
		const { sink, makeEvent } = setup();
		vi.spyOn(fsPromises, "appendFile").mockRejectedValueOnce(new Error("boom"));

		sink.write(makeEvent());
		await expect(sink.flush()).rejects.toThrow("boom");

		sink.write(makeEvent());
		await sink.flush();
		// The failed append did not advance file state, so the retry still
		// opens the file with exactly one header.
		expect(readHeaders(todaysFile())).toHaveLength(1);
		expect(readJsonl(todaysFile())[0].kind).toBe("header");
		expect(readRows(todaysFile())).toHaveLength(1);
	});

	it("drops the oldest events once the buffer overflows", async () => {
		const { sink, makeEvent } = setup({
			bufferLimit: 10,
			flushBatchSize: 10_000,
		});

		for (let i = 0; i < 13; i++) {
			sink.write(makeEvent());
		}
		await sink.flush();

		// 13 written, 3 oldest dropped to honor bufferLimit.
		expect(readRows(todaysFile())).toHaveLength(10);
	});

	it("two sinks with different sessions write to disjoint files", async () => {
		const a = setup();
		const b = setup({}, "ffeeddcc-1111-2222-3333-444444444444");

		for (let i = 0; i < 5; i++) {
			a.sink.write(a.makeEvent());
			b.sink.write(b.makeEvent());
		}
		await Promise.all([a.sink.flush(), b.sink.flush()]);

		expect(readRows(todaysFile(SESSION_SLUG))).toHaveLength(5);
		expect(readRows(todaysFile("ffeeddcc"))).toHaveLength(5);
	});

	it("coalesces concurrent flushes so events write exactly once", async () => {
		const { sink, makeEvent } = setup();

		// Block the first append until we've enqueued more flushes; signal back
		// when the in-flight write reaches `await appendFile` so the test can
		// proceed deterministically without juggling microtasks.
		let signalFirstStarted!: () => void;
		const firstAppendStarted = new Promise<void>((r) => {
			signalFirstStarted = r;
		});
		let releaseFirst!: () => void;
		const firstAppendBlocked = new Promise<void>((r) => {
			releaseFirst = r;
		});
		const realAppend = fsPromises.appendFile.bind(fsPromises);
		const spy = vi
			.spyOn(fsPromises, "appendFile")
			.mockImplementationOnce(async (target, data, opts) => {
				signalFirstStarted();
				await firstAppendBlocked;
				return realAppend(target, data, opts);
			});

		sink.write(makeEvent());
		const inFlight = sink.flush();
		await firstAppendStarted;

		sink.write(makeEvent());
		sink.write(makeEvent());
		const queuedA = sink.flush();
		const queuedB = sink.flush();

		releaseFirst();
		await Promise.all([inFlight, queuedA, queuedB]);

		expect(readRows(todaysFile()).map((l) => l.event_sequence)).toEqual([
			0, 1, 2,
		]);
		// One in-flight + at most one queued; multiple flush() calls do not
		// pile up into separate writes.
		expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it("picks up config changes reactively", async () => {
		const { sink, makeEvent } = setup({ flushBatchSize: 100 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		provider.set(LOCAL_TELEMETRY_SETTING, {
			flushIntervalMs: 1_000_000,
			flushBatchSize: 3,
		});
		sink.write(makeEvent());

		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readRows(todaysFile())).toHaveLength(3);
	});

	it("write() does not throw when an event cannot be serialized", async () => {
		const { sink, makeEvent } = setup();
		const bad = makeEvent();
		(bad.properties as Record<string, unknown>).circular = BigInt(1);

		expect(() => sink.write(bad)).not.toThrow();

		sink.write(makeEvent());
		await sink.flush();
		expect(readRows(todaysFile())).toHaveLength(1);
	});
});
