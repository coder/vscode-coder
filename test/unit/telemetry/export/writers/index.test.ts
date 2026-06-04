import { describe, expect, it, vi } from "vitest";

import { createExportWriter } from "@/telemetry/export/writers";
import { writeJsonArrayExport } from "@/telemetry/export/writers/json";
import { writeOtlpZipExport } from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../mocks/telemetry";

vi.mock("@/telemetry/export/writers/json", () => ({
	writeJsonArrayExport: vi.fn(),
}));
vi.mock("@/telemetry/export/writers/otlp/writer", () => ({
	writeOtlpZipExport: vi.fn(),
}));

const { context } = createTelemetryEventFactory()();
const OUTPUT = "/tmp/out";
const EVENTS = asyncIterable([]);
const OPTIONS = {
	signal: new AbortController().signal,
	onCleanupError: vi.fn(),
};

describe("createExportWriter", () => {
	it("uses the JSON writer for the json format", () => {
		expect(createExportWriter("json", context)).toBe(writeJsonArrayExport);
	});

	it("binds the context and sums signal counts for the otlp format", async () => {
		vi.mocked(writeOtlpZipExport).mockResolvedValue({
			logs: 5,
			traces: 3,
			metrics: 1,
		});

		const writer = createExportWriter("otlp", context);

		await expect(writer(OUTPUT, EVENTS, OPTIONS)).resolves.toBe(9);
		expect(writeOtlpZipExport).toHaveBeenCalledWith(
			OUTPUT,
			EVENTS,
			context,
			OPTIONS,
		);
	});
});
