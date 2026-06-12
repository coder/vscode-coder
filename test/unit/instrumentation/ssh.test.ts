import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SshTelemetry } from "@/instrumentation/ssh";

import { createTelemetryHarness } from "../../mocks/telemetry";
import { makeNetworkInfo } from "../../mocks/testHelpers";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { ssh: new SshTelemetry(service), sink };
}

interface DiscoveryCase {
	pid: number | undefined;
	attempts: number;
	found: string;
}

interface DisposedCase {
	name: string;
	lose: boolean;
	wasLost: string;
}

describe("SshTelemetry", () => {
	describe("traceProcessDiscovery", () => {
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
			expect(replaced.properties).toMatchObject({ was_lost: "true" });
			expect(replaced.measurements).toMatchObject({
				previous_uptime_ms: expect.any(Number),
				lost_duration_ms: expect.any(Number),
			});
		});

		it("emits a replacement event for an instant handover", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processReplaced();

			const replaced = sink.eventsNamed("ssh.process.replaced");
			expect(replaced).toHaveLength(1);
			expect(replaced[0].properties).toMatchObject({ was_lost: "false" });
			expect(replaced[0].measurements).toMatchObject({
				previous_uptime_ms: expect.any(Number),
			});
			expect(replaced[0].measurements.lost_duration_ms).toBeUndefined();
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

		it("emits ssh.process.recovered with recovery_duration_ms after a loss", () => {
			const { ssh, sink } = setup();

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processRecovered();

			const [event] = sink.eventsNamed("ssh.process.recovered");
			expect(event.measurements.recovery_duration_ms).toEqual(
				expect.any(Number),
			);
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
			expect(event.properties).toMatchObject({ was_lost: wasLost });
			expect(event.measurements.uptime_ms).toEqual(expect.any(Number));
		});
	});

	describe("networkSampled", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it.each([
			{
				name: "no change within the cooldown",
				prev: {},
				next: {},
				advanceMs: 1_000,
				expected: 1,
			},
			{
				name: "no change after the cooldown",
				prev: {},
				next: {},
				advanceMs: 16_000,
				expected: 1,
			},
			{
				name: "latency change below both thresholds (50 -> 51)",
				prev: {},
				next: { latency: 51 },
				advanceMs: 15_000,
				expected: 1,
			},
			{
				name: "latency change meeting only the ratio threshold (50 -> 70)",
				prev: {},
				next: { latency: 70 },
				advanceMs: 15_000,
				expected: 1,
			},
			{
				name: "latency change meeting only the absolute threshold (200 -> 230)",
				prev: { latency: 200 },
				next: { latency: 230 },
				advanceMs: 15_000,
				expected: 1,
			},
			{
				name: "latency change meeting both thresholds (50 -> 80)",
				prev: {},
				next: { latency: 80 },
				advanceMs: 15_000,
				expected: 2,
			},
			{
				name: "latency change within the cooldown (50 -> 80)",
				prev: {},
				next: { latency: 80 },
				advanceMs: 1_000,
				expected: 1,
			},
			{
				name: "p2p flip after the cooldown",
				prev: {},
				next: { p2p: false },
				advanceMs: 15_000,
				expected: 2,
			},
			{
				name: "p2p flip within the cooldown",
				prev: {},
				next: { p2p: false },
				advanceMs: 1_000,
				expected: 1,
			},
			{
				name: "DERP region change after the cooldown",
				prev: {},
				next: { preferred_derp: "SFO" },
				advanceMs: 15_000,
				expected: 2,
			},
			{
				name: "heartbeat after 60s without change",
				prev: {},
				next: {},
				advanceMs: 60_000,
				expected: 2,
			},
			{
				name: "baseline established from zero-latency placeholder (0 -> 5)",
				prev: { latency: 0 },
				next: { latency: 5 },
				advanceMs: 15_000,
				expected: 2,
			},
		])(
			"$name -> $expected sample(s)",
			({ prev, next, advanceMs, expected }) => {
				const { ssh, sink } = setup();

				ssh.networkSampled(makeNetworkInfo(prev));
				vi.advanceTimersByTime(advanceMs);
				ssh.networkSampled(makeNetworkInfo({ ...prev, ...next }));

				expect(sink.eventsNamed("ssh.network.sampled")).toHaveLength(expected);
			},
		);

		it("coalesces a change suppressed by the cooldown into a later emission", () => {
			const { ssh, sink } = setup();

			ssh.networkSampled(makeNetworkInfo());
			vi.advanceTimersByTime(3_000);
			ssh.networkSampled(makeNetworkInfo({ p2p: false }));
			vi.advanceTimersByTime(12_000);
			ssh.networkSampled(makeNetworkInfo({ p2p: false }));

			const samples = sink.eventsNamed("ssh.network.sampled");
			expect(samples).toHaveLength(2);
			expect(samples[1].properties.p2p).toBe("false");
		});

		it("includes p2p, preferred_derp, latency, and bandwidth in the emitted sample", () => {
			const { ssh, sink } = setup();

			ssh.networkSampled(makeNetworkInfo({ latency: 25 }));

			const [sample] = sink.eventsNamed("ssh.network.sampled");
			expect(sample.properties).toEqual({ p2p: "true", preferred_derp: "NYC" });
			expect(sample.measurements).toMatchObject({
				latency_ms: 25,
				download_mbits: expect.any(Number),
				upload_mbits: expect.any(Number),
			});
		});
	});
});
