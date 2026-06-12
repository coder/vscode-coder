import { vi } from "vitest";

import {
	buildSession,
	type TelemetryEvent,
	type TelemetryLevel,
	type TelemetrySink,
} from "@/telemetry/event";
import { TelemetryService } from "@/telemetry/service";
import {
	CURRENT_TELEMETRY_SCHEMA_VERSION,
	type SessionContext,
} from "@/telemetry/wireFormat";

import { createMockLogger, MockConfigurationProvider } from "./testHelpers";

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

	eventsNamed(name: string): TelemetryEvent[] {
		return this.events.filter((e) => e.eventName === name);
	}

	/** Returns the single event with `name`, throwing if not exactly one. */
	expectOne(name: string): TelemetryEvent {
		const matches = this.eventsNamed(name);
		if (matches.length !== 1) {
			throw new Error(
				`Expected exactly 1 '${name}' event, got ${matches.length}`,
			);
		}
		return matches[0];
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

/** Sets `coder.telemetry.level=local` so emissions reach the sink. */
export function enableLocalTelemetry(): void {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
}

/** Bundles `enableLocalTelemetry` + a fresh sink + service. */
export function createTelemetryHarness(): {
	sink: TestSink;
	service: TelemetryService;
} {
	enableLocalTelemetry();
	const sink = new TestSink();
	return { sink, service: createTestTelemetryService(sink) };
}

/** Shared session fixture so test values cannot drift. */
export const TEST_SESSION_CONTEXT: SessionContext = {
	extensionVersion: "1.14.5",
	machineId: "machine-id",
	sessionId: "session-id",
	osType: "linux",
	osVersion: "6.0.0",
	hostArch: "x64",
	platformName: "Visual Studio Code",
	platformVersion: "1.106.0",
};

/**
 * Factory for `TelemetryEvent` fixtures. Each call gets a fresh `eventId` and
 * monotonic `eventSequence`; overrides win.
 */
export function createTelemetryEventFactory(): (
	overrides?: Partial<TelemetryEvent>,
) => TelemetryEvent {
	let sequence = 0;
	return (overrides = {}) => {
		const seq = sequence++;
		return {
			eventId: `id-${seq}`,
			eventName: "test.event",
			timestamp: "2026-05-04T12:00:00.000Z",
			eventSequence: seq,
			schemaVersion: CURRENT_TELEMETRY_SCHEMA_VERSION,
			context: {
				...TEST_SESSION_CONTEXT,
				deploymentUrl: "https://coder.example.com",
			},
			properties: {},
			measurements: {},
			...overrides,
		};
	};
}
