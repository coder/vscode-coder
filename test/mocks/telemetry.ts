import { vi } from "vitest";

import type { TelemetryEvent, TelemetrySink } from "@/telemetry/event";

/**
 * In-memory `TelemetrySink` for tests. Captures every written event and
 * exposes `flush`/`dispose` as `vi.fn()` mocks for assertions.
 */
export class TestSink implements TelemetrySink {
	readonly name: string;
	readonly events: TelemetryEvent[] = [];
	readonly flush = vi.fn(() => Promise.resolve());
	readonly dispose = vi.fn(() => Promise.resolve());

	constructor(name = "test") {
		this.name = name;
	}

	write(event: TelemetryEvent): void {
		this.events.push(event);
	}
}
