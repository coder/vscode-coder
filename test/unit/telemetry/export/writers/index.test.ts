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
const DESCRIPTOR = {
	range: { label: "Last 24 hours", filenamePart: "last-24-hours" },
	sourceFiles: 2,
};
const OPTIONS = {
	signal: new AbortController().signal,
	onCleanupError: vi.fn(),
};

describe("createExportWriter", () => {
	it("delegates to the JSON writer, which ignores the descriptor", async () => {
		vi.mocked(writeJsonArrayExport).mockResolvedValue(4);

		const writer = createExportWriter("json", context);

		await expect(writer(OUTPUT, EVENTS, DESCRIPTOR, OPTIONS)).resolves.toBe(4);
		expect(writeJsonArrayExport).toHaveBeenCalledWith(OUTPUT, EVENTS, OPTIONS);
	});

	it("binds the context and sums signal counts for the otlp format", async () => {
		vi.mocked(writeOtlpZipExport).mockResolvedValue({
			logs: 5,
			traces: 3,
			metrics: 1,
		});

		const writer = createExportWriter("otlp", context);

		await expect(writer(OUTPUT, EVENTS, DESCRIPTOR, OPTIONS)).resolves.toBe(9);
		expect(writeOtlpZipExport).toHaveBeenCalledWith(
			OUTPUT,
			EVENTS,
			context,
			DESCRIPTOR,
			OPTIONS,
		);
	});
});
