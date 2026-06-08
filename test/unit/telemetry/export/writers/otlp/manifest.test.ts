import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildManifest,
	MANIFEST_SCHEMA_VERSION,
	type ManifestInput,
} from "@/telemetry/export/writers/otlp/manifest";
import { CURRENT_TELEMETRY_SCHEMA_VERSION } from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

const makeEvent = createTelemetryEventFactory();
const { context } = makeEvent();

const INPUT: ManifestInput = {
	range: { label: "Last 24 hours", startMs: 0, endMs: 86_400_000 },
	sourceFiles: 2,
};

/** `buildManifest` with representative defaults; overrides win. */
function build(overrides: Partial<Parameters<typeof buildManifest>[0]> = {}) {
	return buildManifest({
		format: "otlp-json",
		context,
		input: INPUT,
		sourceEvents: 9,
		records: { logs: 5, traces: 3, metrics: 1 },
		...overrides,
	});
}

describe("buildManifest", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T18:00:00.000Z"));
	});

	afterEach(() => vi.useRealTimers());

	it("captures the manifest and telemetry schema versions separately", () => {
		const manifest = build();

		expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
		expect(manifest.telemetrySchemaVersion).toBe(
			CURRENT_TELEMETRY_SCHEMA_VERSION,
		);
	});

	it("threads format, range, counts, and source metadata into the document", () => {
		expect(build()).toMatchObject({
			format: "otlp-json",
			exportedAt: "2026-05-04T18:00:00.000Z",
			extensionVersion: context.extensionVersion,
			sourceFiles: 2,
			sourceEvents: 9,
			records: { logs: 5, traces: 3, metrics: 1 },
			range: {
				label: "Last 24 hours",
				start: "1970-01-01T00:00:00.000Z",
				end: "1970-01-02T00:00:00.000Z",
			},
		});
	});

	it("renders unset range bounds as null", () => {
		const manifest = build({
			input: { range: { label: "All time" }, sourceFiles: 0 },
		});

		expect(manifest.range).toEqual({
			label: "All time",
			start: null,
			end: null,
		});
	});
});
