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
	describe("traceProcessDiscovery", () => {
		interface DiscoveryCase {
			pid: number | undefined;
			attempts: number;
			found: string;
		}
		it.each<DiscoveryCase>([
			{ pid: 123, attempts: 2, found: "true" },
			{ pid: undefined, attempts: 5, found: "false" },
		])(
			"emits found=$found and attempts=$attempts based on the result",
			async ({ pid, attempts, found }) => {
				const { ssh, sink } = setup();

				await ssh.traceProcessDiscovery(() =>
					Promise.resolve({ pid, attempts }),
				);

				const [event] = sink.eventsNamed("ssh.process.discovered");
				expect(event.properties).toMatchObject({ result: "success", found });
				expect(event.measurements.attempts).toBe(attempts);
			},
		);
	});

	describe("processReplaced", () => {
		it("emits a replacement (not recovery) when the prior process was lost", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processReplaced();

			expect(sink.events.map((e) => e.eventName)).toEqual([
				"ssh.process.lost",
				"ssh.process.replaced",
			]);
			const [replaced] = sink.eventsNamed("ssh.process.replaced");
			expect(replaced.properties).toMatchObject({ wasLost: "true" });
			expect(replaced.measurements).toMatchObject({
				previousUptimeMs: expect.any(Number),
				lostDurationMs: expect.any(Number),
			});
		});

		it("emits a replacement event for an instant handover", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processReplaced();

			const replaced = sink.eventsNamed("ssh.process.replaced");
			expect(replaced).toHaveLength(1);
			expect(replaced[0].properties).toMatchObject({ wasLost: "false" });
			expect(replaced[0].measurements).toMatchObject({
				previousUptimeMs: expect.any(Number),
			});
			expect(replaced[0].measurements.lostDurationMs).toBeUndefined();
		});

		it("emits nothing if there was no prior process", () => {
			const { ssh, sink } = setup();

			ssh.processReplaced();

			expect(sink.events).toHaveLength(0);
		});
	});

	describe("processRecovered", () => {
		it("is a no-op when the process is not currently lost", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processRecovered();

			expect(sink.events).toHaveLength(0);
		});

		it("emits ssh.process.recovered with recoveryDurationMs after a loss", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processRecovered();

			const [event] = sink.eventsNamed("ssh.process.recovered");
			expect(event.measurements.recoveryDurationMs).toEqual(expect.any(Number));
		});

		it("does not double-emit when called twice without another loss", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processRecovered();
			ssh.processRecovered();

			expect(sink.eventsNamed("ssh.process.recovered")).toHaveLength(1);
		});
	});

	describe("processLost", () => {
		it("is a no-op when there is no started process", () => {
			const { ssh, sink } = setup();

			ssh.processLost("stale_network_info");

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

	describe("disposed", () => {
		it("is a no-op when there is no started process", () => {
			const { ssh, sink } = setup();

			ssh.disposed();

			expect(sink.events).toHaveLength(0);
		});

		interface DisposedCase {
			name: string;
			lose: boolean;
			wasLost: string;
		}
		it.each<DisposedCase>([
			{ name: "from a healthy state", lose: false, wasLost: "false" },
			{ name: "after the process was lost", lose: true, wasLost: "true" },
		])("emits a terminal event $name", ({ lose, wasLost }) => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			if (lose) {
				ssh.processLost("stale_network_info");
			}
			ssh.disposed();

			const [event] = sink.eventsNamed("ssh.process.disposed");
			expect(event.properties).toMatchObject({ wasLost });
			expect(event.measurements.uptimeMs).toEqual(expect.any(Number));
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

			expect(sink.eventsNamed("ssh.network.sampled")).toHaveLength(expected);
		});

		it("includes p2p, preferredDerp, latency, and bandwidth in the emitted sample", () => {
			const { ssh, sink } = setup();

			ssh.networkSampled(makeNetworkInfo({ latency: 25 }));

			const [sample] = sink.eventsNamed("ssh.network.sampled");
			expect(sample.properties).toEqual({ p2p: "true", preferredDerp: "NYC" });
			expect(sample.measurements).toMatchObject({
				latencyMs: 25,
				downloadMbits: expect.any(Number),
				uploadMbits: expect.any(Number),
			});
		});
	});
});
