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
	LOCAL_JSONL_SETTING,
	type LocalJsonlConfig,
} from "@/settings/telemetry";
import { LocalJsonlSink } from "@/telemetry/sinks/localJsonlSink";

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

const BASE_DIR = "/telemetry";
const SESSION_ID = "12345678-aaaa-bbbb-cccc-dddddddddddd";
const SESSION_SLUG = "12345678";

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

const setMtimeAgo = (filePath: string, ageMs: number): void => {
	const t = (Date.now() - ageMs) / 1000;
	vol.utimesSync(filePath, t, t);
};

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
		config: Partial<LocalJsonlConfig> = {},
		sessionId = SESSION_ID,
	) {
		provider.set(LOCAL_JSONL_SETTING, {
			flushIntervalMs: 1_000_000,
			...config,
		});
		const logger = createMockLogger();
		const sink = LocalJsonlSink.start({ baseDir: BASE_DIR, sessionId }, logger);
		active.push(sink);

		let seq = 0;
		const makeEvent = (
			overrides: Partial<TelemetryEvent> = {},
		): TelemetryEvent => ({
			eventId: `id-${seq}`,
			eventName: "test.event",
			timestamp: "2026-05-04T12:00:00.000Z",
			eventSequence: seq++,
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
		});

		return { sink, logger, makeEvent };
	}

	it("flushes the buffer when the interval fires", async () => {
		vi.useFakeTimers();
		const { sink, makeEvent } = setup({ flushIntervalMs: 1000 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		await vi.advanceTimersByTimeAsync(1000);
		expect(readJsonl(todaysFile())).toHaveLength(2);
	});

	it("flushes early once the buffer reaches flushBatchSize", async () => {
		const { sink, makeEvent } = setup({ flushBatchSize: 3 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		sink.write(makeEvent());
		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readJsonl(todaysFile())).toHaveLength(3);
	});

	it("drops the oldest events when the buffer exceeds bufferLimit", async () => {
		const { sink, makeEvent } = setup({
			bufferLimit: 5,
			flushBatchSize: 10_000,
		});

		for (let i = 0; i < 8; i++) {
			sink.write(makeEvent());
		}
		await sink.flush();

		expect(readJsonl(todaysFile()).map((l) => l.event_sequence)).toEqual([
			3, 4, 5, 6, 7,
		]);
	});

	it("emits one overflow warning per burst regardless of flush outcome", async () => {
		const { sink, logger, makeEvent } = setup({
			bufferLimit: 5,
			flushBatchSize: 10_000,
		});
		const overflowWarnings = (): number =>
			vi.mocked(logger.warn).mock.calls.filter((c) => {
				const arg = c[0];
				return typeof arg === "string" && arg.includes("buffer overflow");
			}).length;
		const overflowBuffer = (): void => {
			for (let i = 0; i < 8; i++) {
				sink.write(makeEvent());
			}
		};

		overflowBuffer();
		await sink.flush();

		vi.spyOn(fsPromises, "appendFile").mockRejectedValueOnce(new Error("boom"));
		overflowBuffer();
		await sink.flush();

		overflowBuffer();
		await sink.flush();

		expect(overflowWarnings()).toBe(3);
	});

	it("flushes pending events on dispose", async () => {
		const { sink, makeEvent } = setup();
		sink.write(makeEvent());
		sink.write(makeEvent());

		await sink.dispose();

		expect(readJsonl(todaysFile())).toHaveLength(2);
	});

	it("ignores writes after dispose", async () => {
		const { sink, makeEvent } = setup();
		sink.write(makeEvent());
		sink.write(makeEvent());
		await sink.dispose();

		sink.write(makeEvent());
		sink.write(makeEvent());

		expect(readJsonl(todaysFile())).toHaveLength(2);
	});

	it("rotates to a numbered segment once maxFileBytes is exceeded", async () => {
		// A serialized event is around 400 bytes, so 900 holds 2 events but not 3.
		const { sink, makeEvent } = setup({ maxFileBytes: 900 });

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
		const { sink, makeEvent } = setup();

		sink.write(makeEvent());
		await sink.flush();

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

		setup({ maxAgeDays: 30 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR)).toEqual([
				`telemetry-${today}-bbbb2222.jsonl`,
			]),
		);
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

		setup({ maxAgeDays: 365, maxTotalBytes: 4500 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR).toSorted()).toEqual([
				"telemetry-2026-04-02-b.jsonl",
				"telemetry-2026-04-03-c.jsonl",
			]),
		);
	});

	it("keeps deleting until total size is under maxTotalBytes", async () => {
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

		setup({ maxAgeDays: 365, maxTotalBytes: 2500 });

		await vi.waitFor(() =>
			expect(vol.readdirSync(BASE_DIR)).toEqual([
				"telemetry-2026-04-03-c.jsonl",
			]),
		);
	});

	it("emits valid snake_case JSONL with optional fields when set, omitting when not", async () => {
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

	it("does not throw when fs.appendFile rejects, and recovers on the next flush", async () => {
		const { sink, makeEvent } = setup();
		vi.spyOn(fsPromises, "appendFile").mockRejectedValueOnce(new Error("boom"));

		sink.write(makeEvent());
		await expect(sink.flush()).resolves.toBeUndefined();

		sink.write(makeEvent());
		await sink.flush();
		expect(readJsonl(todaysFile())).toHaveLength(1);
	});

	it("two sinks with different sessions write to disjoint files", async () => {
		const a = setup();
		const b = setup({}, "ffeeddcc-1111-2222-3333-444444444444");

		for (let i = 0; i < 5; i++) {
			a.sink.write(a.makeEvent());
			b.sink.write(b.makeEvent());
		}
		await Promise.all([a.sink.flush(), b.sink.flush()]);

		expect(readJsonl(todaysFile(SESSION_SLUG))).toHaveLength(5);
		expect(readJsonl(todaysFile("ffeeddcc"))).toHaveLength(5);
	});

	it("coalesces concurrent flush requests into at most two appendFile calls", async () => {
		const { sink, makeEvent } = setup();

		let resolveFirst!: () => void;
		const firstAppendDone = new Promise<void>((r) => {
			resolveFirst = r;
		});
		const realAppend = fsPromises.appendFile.bind(fsPromises);
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

		resolveFirst();
		await Promise.all([p1, p2, p3]);

		expect(spy).toHaveBeenCalledTimes(2);
		expect(readJsonl(todaysFile()).map((l) => l.event_sequence)).toEqual([
			0, 1,
		]);
	});

	it("picks up config changes reactively", async () => {
		const { sink, makeEvent } = setup({ flushBatchSize: 100 });

		sink.write(makeEvent());
		sink.write(makeEvent());
		expect(vol.existsSync(todaysFile())).toBe(false);

		provider.set(LOCAL_JSONL_SETTING, {
			flushIntervalMs: 1_000_000,
			flushBatchSize: 3,
		});
		sink.write(makeEvent());

		await vi.waitFor(() => expect(vol.existsSync(todaysFile())).toBe(true));
		expect(readJsonl(todaysFile())).toHaveLength(3);
	});

	it("write() does not throw when an event cannot be serialized", async () => {
		const { sink, makeEvent } = setup();
		const bad = makeEvent();
		(bad.properties as Record<string, unknown>).circular = BigInt(1);

		expect(() => sink.write(bad)).not.toThrow();

		sink.write(makeEvent());
		await sink.flush();
		expect(readJsonl(todaysFile())).toHaveLength(1);
	});
});
