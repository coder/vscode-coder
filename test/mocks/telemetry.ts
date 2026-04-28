import { vi } from "vitest";

import type {
	TelemetryEvent,
	TelemetryLevel,
	TelemetrySink,
} from "@/telemetry/event";

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
