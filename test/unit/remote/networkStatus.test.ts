import { describe, expect, it } from "vitest";
import { ThemeColor } from "vscode";

import { NetworkStatusReporter } from "@/remote/networkStatus";

import {
	makeNetworkInfo,
	MockConfigurationProvider,
	MockStatusBarItem,
} from "../../mocks/testHelpers";

function setup(latencyMs?: number) {
	const cfg = new MockConfigurationProvider();
	if (latencyMs !== undefined) {
		cfg.set("coder.networkThreshold.latencyMs", latencyMs);
	}
	const bar = new MockStatusBarItem();
	const reporter = new NetworkStatusReporter(bar);
	return { bar, reporter };
}

function tooltipOf(bar: MockStatusBarItem): string {
	const t = bar.tooltip;
	return typeof t === "string" ? t : (t?.value ?? "");
}

describe("NetworkStatusReporter status bar text", () => {
	it("shows Direct prefix for P2P connections", () => {
		const { bar, reporter } = setup();
		reporter.update(makeNetworkInfo({ p2p: true, latency: 25.5 }), false);
		expect(bar.text).toBe("$(globe) Direct (25.50ms)");
	});

	it("shows the DERP region for relay connections", () => {
		const { bar, reporter } = setup();
		reporter.update(
			makeNetworkInfo({ p2p: false, preferred_derp: "SFO", latency: 40 }),
			false,
		);
		expect(bar.text).toBe("$(globe) SFO (40.00ms)");
	});

	it("shows just the Coder Connect label, ignoring any reported latency", () => {
		const { bar, reporter } = setup();
		reporter.update(
			makeNetworkInfo({ using_coder_connect: true, latency: 30 }),
			false,
		);
		expect(bar.text).toBe("$(globe) Coder Connect");
	});

	it("marks stale readings with a leading tilde", () => {
		const { bar, reporter } = setup();
		reporter.update(makeNetworkInfo({ latency: 100 }), true);
		expect(bar.text).toContain("(~100.00ms)");
	});
});

describe("NetworkStatusReporter tooltip", () => {
	it("leads with a friendly P2P summary and omits action links when healthy", () => {
		const { bar, reporter } = setup(200);
		reporter.update(makeNetworkInfo({ p2p: true, latency: 50 }), false);
		const t = tooltipOf(bar);
		expect(t).toContain("Directly connected peer-to-peer");
		expect(t).toContain("Latency: 50.00ms (threshold: 200ms)");
		expect(t).toContain("Download: 50 Mbit/s");
		expect(t).toContain("Upload: 10 Mbit/s");
		expect(t).not.toContain("Slow connection detected");
		expect(t).not.toContain("Run latency test");
		expect(t).not.toContain("Configure threshold");
	});

	it("leads with a relay explainer mentioning the DERP region", () => {
		const { bar, reporter } = setup(200);
		reporter.update(
			makeNetworkInfo({ p2p: false, preferred_derp: "SFO", latency: 40 }),
			false,
		);
		const t = tooltipOf(bar);
		expect(t).toContain("Connected via SFO relay");
		expect(t).toContain("Will switch to peer-to-peer when available");
	});

	it("keeps the connection summary and adds warning header + action links when slow", () => {
		const { bar, reporter } = setup(100);
		reporter.update(makeNetworkInfo({ p2p: true, latency: 350 }), false);
		reporter.update(makeNetworkInfo({ p2p: true, latency: 350 }), false);
		const t = tooltipOf(bar);
		expect(t).toContain("$(warning) **Slow connection detected**");
		expect(t).toContain("Directly connected peer-to-peer");
		expect(t).toContain("Latency: 350.00ms (threshold: 100ms)");
		expect(t).toContain("Run latency test");
		expect(t).toContain("Configure threshold");
	});

	it("appends a stale footer at the bottom of the tooltip", () => {
		const { bar, reporter } = setup(200);
		reporter.update(makeNetworkInfo({ latency: 50 }), true);
		const t = tooltipOf(bar);
		expect(t).toContain("Readings are stale");
		// Footer placement: stale banner should come after the metrics.
		expect(t.indexOf("Upload:")).toBeLessThan(t.indexOf("Readings are stale"));
	});

	it("omits threshold annotation and warning when disabled", () => {
		const { bar, reporter } = setup(0);
		reporter.update(makeNetworkInfo({ latency: 9999 }), false);
		const t = tooltipOf(bar);
		expect(t).toContain("Latency: 9999.00ms");
		expect(t).not.toContain("threshold:");
		expect(t).not.toContain("Slow connection detected");
	});

	it("shows a dedicated message for Coder Connect instead of empty metrics", () => {
		const { bar, reporter } = setup(200);
		reporter.update(makeNetworkInfo({ using_coder_connect: true }), false);
		const t = tooltipOf(bar);
		expect(t).toContain("Connected using Coder Connect");
		expect(t).toContain("Detailed network stats aren't collected");
		expect(t).not.toContain("Download:");
		expect(t).not.toContain("Upload:");
		expect(t).not.toContain("Latency:");
	});
});

describe("NetworkStatusReporter warning state", () => {
	const slow = makeNetworkInfo({ latency: 500 });
	const healthy = makeNetworkInfo({ latency: 50 });

	it("does not warn on a single slow poll", () => {
		const { bar, reporter } = setup(100);
		reporter.update(slow, false);
		expect(bar.backgroundColor).toBeUndefined();
		expect(bar.command).toBeUndefined();
	});

	it("warns after two consecutive slow polls", () => {
		const { bar, reporter } = setup(100);
		reporter.update(slow, false);
		reporter.update(slow, false);
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);
		expect(bar.command).toBe("coder.pingWorkspace");
	});

	it("stays warning across a single healthy poll mid-streak", () => {
		const { bar, reporter } = setup(100);
		reporter.update(slow, false);
		reporter.update(slow, false);
		reporter.update(healthy, false);
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);
	});

	it("clears after enough healthy polls to drain the counter", () => {
		const { bar, reporter } = setup(100);
		reporter.update(slow, false);
		reporter.update(slow, false);
		reporter.update(healthy, false);
		reporter.update(healthy, false);
		expect(bar.backgroundColor).toBeUndefined();
		expect(bar.command).toBeUndefined();
	});

	it("never warns for Coder Connect, even if the CLI reports high latency", () => {
		const { bar, reporter } = setup(100);
		const slowCoderConnect = makeNetworkInfo({
			using_coder_connect: true,
			latency: 500,
		});
		reporter.update(slowCoderConnect, false);
		reporter.update(slowCoderConnect, false);
		expect(bar.backgroundColor).toBeUndefined();
		expect(bar.command).toBeUndefined();
	});

	it("never warns when the threshold is 0", () => {
		const { bar, reporter } = setup(0);
		for (let i = 0; i < 5; i++) {
			reporter.update(makeNetworkInfo({ latency: 9999 }), false);
		}
		expect(bar.backgroundColor).toBeUndefined();
	});
});
