import * as fsp from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import * as files from "@/telemetry/export/files";
import {
	collectTelemetryExport,
	type ExportRequest,
	type ExportRuntime,
} from "@/telemetry/export/pipeline";

import { asyncIterable } from "../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../mocks/telemetry";

import type { TelemetryEvent } from "@/telemetry/event";
import type { TelemetryDateRange } from "@/telemetry/export/range";
import type { ExportWriter } from "@/telemetry/export/writers/types";
import type { FlushStatus } from "@/telemetry/service";

vi.mock("@/telemetry/export/files", () => ({
	listTelemetryFilesForRange: vi.fn(),
	streamTelemetryEvents: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ rm: vi.fn(() => Promise.resolve()) }));

const makeEvent = createTelemetryEventFactory();
const RANGE: TelemetryDateRange = {
	label: "Last 24 hours",
	filenamePart: "last-24-hours",
};
const FILE_PATHS = ["/tmp/telemetry/a.jsonl", "/tmp/telemetry/b.jsonl"];
const OUTPUT_PATH = "/tmp/out.json";
const OK_FLUSH: FlushStatus = { ok: true, sinks: [] };

function setup(
	opts: {
		events?: readonly TelemetryEvent[];
		filePaths?: readonly string[];
		signal?: AbortSignal;
		writeCount?: number;
		flush?: FlushStatus;
	} = {},
) {
	vi.resetAllMocks();
	vi.mocked(fsp.rm).mockResolvedValue(undefined);
	vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([
		...(opts.filePaths ?? FILE_PATHS),
	]);
	vi.mocked(files.streamTelemetryEvents).mockReturnValue(
		asyncIterable(opts.events ?? [makeEvent()]),
	);

	const writer = vi.fn<ExportWriter>(() =>
		Promise.resolve(opts.writeCount ?? 1),
	);
	const flushTelemetry = vi.fn(() => Promise.resolve(opts.flush ?? OK_FLUSH));
	const runtime: ExportRuntime = {
		signal: opts.signal ?? new AbortController().signal,
		flushTelemetry,
		report: vi.fn(),
		onFlushIncomplete: vi.fn(),
		onCleanupError: vi.fn(),
	};
	const request: ExportRequest = {
		telemetryDir: "/tmp/telemetry",
		range: RANGE,
		outputPath: OUTPUT_PATH,
		writer,
	};
	return {
		runtime,
		writer,
		flushTelemetry,
		run: () => collectTelemetryExport(request, runtime),
	};
}

describe("collectTelemetryExport", () => {
	it("flushes telemetry before listing files", async () => {
		const { run, flushTelemetry } = setup();

		await run();

		const [flushOrder] = flushTelemetry.mock.invocationCallOrder;
		const [listOrder] = vi.mocked(files.listTelemetryFilesForRange).mock
			.invocationCallOrder;
		expect(flushOrder).toBeLessThan(listOrder);
	});

	it("notifies the host when the flush did not fully succeed", async () => {
		const { run, runtime } = setup({
			flush: { ok: false, sinks: [{ name: "local-jsonl", ok: false }] },
		});

		await run();

		expect(runtime.onFlushIncomplete).toHaveBeenCalled();
	});

	it("does not notify the host when the flush succeeds", async () => {
		const { run, runtime } = setup();

		await run();

		expect(runtime.onFlushIncomplete).not.toHaveBeenCalled();
	});

	it("returns 0 and never writes when no files cover the range", async () => {
		const { run, writer } = setup({ filePaths: [] });

		await expect(run()).resolves.toBe(0);
		expect(writer).not.toHaveBeenCalled();
		expect(fsp.rm).not.toHaveBeenCalled();
	});

	it("returns the writer's event count", async () => {
		const { run } = setup({ writeCount: 5 });

		await expect(run()).resolves.toBe(5);
	});

	it("passes the descriptor, output path, signal, and cleanup handler to the writer", async () => {
		const { run, runtime, writer } = setup({ writeCount: 2 });

		await run();

		expect(writer).toHaveBeenCalledWith(
			OUTPUT_PATH,
			expect.anything(),
			{ range: RANGE, sourceFiles: FILE_PATHS.length },
			{ signal: runtime.signal, onCleanupError: runtime.onCleanupError },
		);
	});

	it("removes the empty output file when the writer wrote nothing", async () => {
		const { run } = setup({ writeCount: 0 });

		await expect(run()).resolves.toBe(0);
		expect(fsp.rm).toHaveBeenCalledWith(OUTPUT_PATH, { force: true });
	});

	it("keeps the file when at least one event was written", async () => {
		const { run } = setup({ writeCount: 1 });

		await run();

		expect(fsp.rm).not.toHaveBeenCalled();
	});

	it("reports a cleanup failure when removing an empty export fails", async () => {
		const { run, runtime } = setup({ writeCount: 0 });
		vi.mocked(fsp.rm).mockRejectedValue(new Error("EACCES"));

		await expect(run()).resolves.toBe(0);
		expect(runtime.onCleanupError).toHaveBeenCalledWith(
			expect.any(Error),
			OUTPUT_PATH,
		);
	});

	it("aborts after flushing, before listing, when already cancelled", async () => {
		const controller = new AbortController();
		controller.abort(new Error("user cancelled"));
		const { run, flushTelemetry } = setup({ signal: controller.signal });

		await expect(run()).rejects.toThrow("user cancelled");
		expect(flushTelemetry).toHaveBeenCalled();
		expect(files.listTelemetryFilesForRange).not.toHaveBeenCalled();
	});
});
