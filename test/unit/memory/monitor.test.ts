import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryTelemetry } from "@/instrumentation/memory";
import { MemoryMonitor } from "@/memory/monitor";

import { createTelemetryHarness, type TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { MemoryStatus } from "@/memory/pressure";
import type { MemorySample } from "@/memory/usage";

const sample = (percent: number): MemorySample => ({
	usedBytes: percent,
	totalBytes: 100,
	source: "host",
});

describe("MemoryMonitor", () => {
	let config: MockConfigurationProvider;
	let sink: TestSink;
	let telemetry: MemoryTelemetry;
	let next: () => Promise<MemorySample | undefined>;
	let polls: number;

	beforeEach(() => {
		vi.useFakeTimers();
		const harness = createTelemetryHarness();
		sink = harness.sink;
		telemetry = new MemoryTelemetry(harness.service);
		config = new MockConfigurationProvider();
		config.set("coder.telemetry.level", "local");
		next = () => Promise.resolve(sample(50));
		polls = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function start() {
		const monitor = new MemoryMonitor(
			() => {
				polls++;
				return next();
			},
			telemetry,
			createMockLogger(),
		);
		const statuses: MemoryStatus[] = [];
		monitor.onDidChange((s) => statuses.push(s));
		return { monitor, statuses };
	}

	it("polls right away and every 10 seconds, logging each state change", async () => {
		const { monitor, statuses } = start();
		await vi.advanceTimersByTimeAsync(0);
		next = () => Promise.resolve(sample(90));
		await vi.advanceTimersByTimeAsync(20_000);
		monitor.dispose();
		await vi.advanceTimersByTimeAsync(60_000);

		expect(statuses.map((s) => s.state)).toEqual(["normal", "normal", "high"]);
		expect(
			sink.eventsNamed("memory.state_transitioned").map((e) => e.properties),
		).toEqual([
			{ from: "unavailable", to: "normal", source: "host" },
			{ from: "normal", to: "high", source: "host", trigger: "usage" },
		]);
	});

	it("skips a poll while the previous read is still pending", async () => {
		let release = (): void => undefined;
		next = () =>
			new Promise((resolve) => {
				release = () => resolve(undefined);
			});
		const { monitor, statuses } = start();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(polls).toBe(1);
		release();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(polls).toBe(2);
		expect(statuses).toHaveLength(1);
		monitor.dispose();
	});

	it("re-polls as soon as the threshold changes", async () => {
		const { monitor } = start();
		await vi.advanceTimersByTimeAsync(0);
		config.set("coder.memoryMonitor.warningThreshold", 0);
		await vi.advanceTimersByTimeAsync(0);
		expect(polls).toBe(2);
		monitor.dispose();
	});
});
