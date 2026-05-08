import { describe, it, expect } from "vitest";

import { SshTelemetry } from "@/instrumentation/ssh";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import { MockConfigurationProvider } from "../../mocks/testHelpers";

import type { NetworkInfo } from "@/remote/sshProcess";

function makeTelemetry() {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	const sink = new TestSink();
	return { telemetry: createTestTelemetryService(sink), sink };
}

function makeNetwork(overrides: Partial<NetworkInfo> = {}): NetworkInfo {
	return {
		p2p: true,
		latency: 50,
		preferred_derp: "NYC",
		derp_latency: { NYC: 10 },
		upload_bytes_sec: 1_250_000,
		download_bytes_sec: 6_250_000,
		using_coder_connect: false,
		...overrides,
	};
}

describe("SshTelemetry", () => {
	describe("processReplaced", () => {
		it("emits a recovery when the prior process was already marked lost", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processReplaced();

			const events = sink.events.map((e) => e.eventName);
			expect(events).toEqual(["ssh.process.lost", "ssh.process.recovered"]);
			await telemetry.dispose();
		});

		it("emits a replacement event for an instant handover", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.processStarted();
			ssh.processReplaced();

			const replaced = sink.events.filter(
				(e) => e.eventName === "ssh.process.replaced",
			);
			expect(replaced).toHaveLength(1);
			expect(replaced[0].measurements).toMatchObject({
				previousUptimeMs: expect.any(Number),
			});
			await telemetry.dispose();
		});

		it("emits nothing if there was no prior process", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.processReplaced();

			expect(sink.events).toHaveLength(0);
			await telemetry.dispose();
		});
	});

	describe("processLost", () => {
		it("is a no-op when there is no started process", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.processLost("disposed");

			expect(sink.events).toHaveLength(0);
			await telemetry.dispose();
		});

		it("does not double-emit when called twice without a recovery", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.processStarted();
			ssh.processLost("stale_network_info");
			ssh.processLost("missing_network_info");

			const lost = sink.events.filter(
				(e) => e.eventName === "ssh.process.lost",
			);
			expect(lost).toHaveLength(1);
			expect(lost[0].properties).toMatchObject({ cause: "stale_network_info" });
			await telemetry.dispose();
		});
	});

	describe("networkSampled", () => {
		it("emits the first sample and skips unchanged follow-ups", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.networkSampled(makeNetwork());
			ssh.networkSampled(makeNetwork());

			const samples = sink.events.filter(
				(e) => e.eventName === "ssh.network.sample",
			);
			expect(samples).toHaveLength(1);
			await telemetry.dispose();
		});

		it("re-samples on a p2p flip inside the heartbeat window", async () => {
			const { telemetry, sink } = makeTelemetry();
			const ssh = new SshTelemetry(telemetry);

			ssh.networkSampled(makeNetwork({ p2p: true }));
			ssh.networkSampled(makeNetwork({ p2p: false }));

			const samples = sink.events.filter(
				(e) => e.eventName === "ssh.network.sample",
			);
			expect(samples).toHaveLength(2);
			expect(samples[1].properties.p2p).toBe("false");
			await telemetry.dispose();
		});
	});
});
