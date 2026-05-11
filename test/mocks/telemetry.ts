import { vi } from "vitest";

import {
	buildSession,
	type TelemetryEvent,
	type TelemetryLevel,
	type TelemetrySink,
} from "@/telemetry/event";
import { TelemetryService } from "@/telemetry/service";

import { createMockLogger } from "./testHelpers";

/**
 * In-memory `TelemetrySink` for tests. Captures every written event and
 * exposes `flush`/`dispose` as `vi.fn()` mocks for assertions.
 */
export class TestSink implements TelemetrySink {
	readonly name: string;
	readonly minLevel: TelemetryLevel;
	readonly events: TelemetryEvent[] = [];
	readonly flush = vi.fn(() => Promise.resolve());
	readonly dispose = vi.fn(() => Promise.resolve());

	constructor(name = "test", minLevel: TelemetryLevel = "local") {
		this.name = name;
		this.minLevel = minLevel;
	}

	write(event: TelemetryEvent): void {
		this.events.push(event);
	}
}

export function createTestTelemetryService(
	sink: TestSink = new TestSink(),
): TelemetryService {
	return new TelemetryService(
		buildSession("1.2.3-test", "test-session"),
		[sink],
		createMockLogger(),
	);
}
