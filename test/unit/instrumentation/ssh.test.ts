import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SshTelemetry } from "@/instrumentation/ssh";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	makeNetworkInfo,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

function setup() {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	const sink = new TestSink();
	return { ssh: new SshTelemetry(createTestTelemetryService(sink)), sink };
}

describe("SshTelemetry", () => {
	describe("processReplaced", () => {
		it("emits a recovery when the prior process was already marked lost", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processReplaced();

			expect(sink.events.map((e) => e.eventName)).toEqual([
				"ssh.process.lost",
				"ssh.process.recovered",
			]);
		});

		it("emits a replacement event for an instant handover", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processReplaced();

			const replaced = sink.eventsNamed("ssh.process.replaced");
			expect(replaced).toHaveLength(1);
			expect(replaced[0].measurements).toMatchObject({
				previousUptimeMs: expect.any(Number),
			});
		});

		it("emits nothing if there was no prior process", () => {
			const { ssh, sink } = setup();

			ssh.processReplaced();

			expect(sink.events).toHaveLength(0);
		});
	});

	describe("processLost", () => {
		it("is a no-op when there is no started process", () => {
			const { ssh, sink } = setup();

			ssh.processLost("disposed");

			expect(sink.events).toHaveLength(0);
		});

		it("does not double-emit when called twice without a recovery", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processLost("missing_network_info");

			const lost = sink.eventsNamed("ssh.process.lost");
			expect(lost).toHaveLength(1);
			expect(lost[0].properties.cause).toBe("stale_network_info");
		});
	});

	describe("networkSampled", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it.each([
			{ name: "no change in window", next: {}, advanceMs: 1_000, expected: 1 },
			{
				name: "small latency change (under 10%)",
				next: { latency: 51 },
				advanceMs: 1_000,
				expected: 1,
			},
			{ name: "p2p flip", next: { p2p: false }, advanceMs: 1_000, expected: 2 },
			{
				name: "DERP region change",
				next: { preferred_derp: "SFO" },
				advanceMs: 1_000,
				expected: 2,
			},
			{
				name: "large latency swing (over 10%)",
				next: { latency: 100 },
				advanceMs: 1_000,
				expected: 2,
			},
			{
				name: "heartbeat after 60s without change",
				next: {},
				advanceMs: 60_000,
				expected: 2,
			},
		])("$name -> $expected sample(s)", ({ next, advanceMs, expected }) => {
			const { ssh, sink } = setup();

			ssh.networkSampled(makeNetworkInfo());
			vi.advanceTimersByTime(advanceMs);
			ssh.networkSampled(makeNetworkInfo(next));

			expect(sink.eventsNamed("ssh.network.sample")).toHaveLength(expected);
		});

		it("includes p2p, derp, latency, and bandwidth in the emitted sample", () => {
			const { ssh, sink } = setup();

			ssh.networkSampled(makeNetworkInfo({ latency: 25 }));

			const [sample] = sink.eventsNamed("ssh.network.sample");
			expect(sample.properties).toEqual({ p2p: "true", derp: "NYC" });
			expect(sample.measurements).toMatchObject({
				latencyMs: 25,
				downloadMbits: expect.any(Number),
				uploadMbits: expect.any(Number),
			});
		});
	});
});
