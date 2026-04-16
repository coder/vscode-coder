import { describe, expect, it } from "vitest";
import { ThemeColor } from "vscode";

import {
	buildNetworkTooltip,
	isLatencySlow,
	NetworkStatusReporter,
	type NetworkThresholds,
} from "@/remote/networkStatus";

import {
	MockConfigurationProvider,
	MockStatusBar,
} from "../../mocks/testHelpers";

import type { NetworkInfo } from "@/remote/sshProcess";

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

const defaultThresholds: NetworkThresholds = { latencyMs: 200 };

function tooltip(
	overrides: Partial<NetworkInfo> = {},
	options: {
		latencySlow?: boolean;
		thresholds?: NetworkThresholds;
	} = {},
) {
	return buildNetworkTooltip(
		makeNetwork(overrides),
		options.latencySlow ?? false,
		options.thresholds ?? defaultThresholds,
	);
}

describe("isLatencySlow", () => {
	it("returns false when latency is within threshold", () => {
		expect(isLatencySlow(makeNetwork({ latency: 50 }), defaultThresholds)).toBe(
			false,
		);
	});

	it("returns true when latency exceeds threshold", () => {
		expect(
			isLatencySlow(makeNetwork({ latency: 250 }), defaultThresholds),
		).toBe(true);
	});

	it("ignores latency when threshold is 0", () => {
		expect(
			isLatencySlow(makeNetwork({ latency: 9999 }), { latencyMs: 0 }),
		).toBe(false);
	});
});

describe("buildNetworkTooltip", () => {
	it("shows all metrics without warning or actions in normal state", () => {
		const t = tooltip();
		expect(t.value).toContain("Latency: 50.00ms");
		expect(t.value).toContain("Download: 50 Mbit/s");
		expect(t.value).toContain("Upload: 10 Mbit/s");
		expect(t.value).not.toContain("$(warning)");
		expect(t.value).not.toContain("Slow connection");
		expect(t.value).not.toContain("command:coder.pingWorkspace");
	});

	it("shows warning header, threshold, and action links when latency is slow", () => {
		const t = tooltip({ latency: 350 }, { latencySlow: true });
		expect(t.value).toContain("$(warning) **Slow connection detected**");
		expect(t.value).toContain("Latency: 350.00ms (threshold: 200ms)");
		expect(t.value).toContain("command:coder.pingWorkspace");
		expect(t.value).toContain("command:workbench.action.openSettings");
		expect(t.value).toContain("Ping workspace");
		expect(t.value).toContain("Configure threshold");
	});

	it("does not mark throughput lines with warnings", () => {
		const t = tooltip({ download_bytes_sec: 100_000 }, { latencySlow: true });
		expect(t.value).not.toContain("Download: 800 kbit/s $(warning)");
	});

	it.each<{ desc: string; overrides: Partial<NetworkInfo>; expected: string }>([
		{
			desc: "P2P",
			overrides: { p2p: true },
			expected: "Connection: Direct (P2P)",
		},
		{
			desc: "relay",
			overrides: { p2p: false, preferred_derp: "SFO" },
			expected: "Connection: SFO (relay)",
		},
		{
			desc: "Coder Connect",
			overrides: { using_coder_connect: true },
			expected: "Connection: Coder Connect",
		},
	])("shows $desc connection type", ({ overrides, expected }) => {
		expect(tooltip(overrides).value).toContain(expected);
	});
});

describe("NetworkStatusReporter hysteresis", () => {
	function setup(latencyMs: number) {
		const cfg = new MockConfigurationProvider();
		cfg.set("coder.networkThreshold.latencyMs", latencyMs);
		const bar = new MockStatusBar();
		const reporter = new NetworkStatusReporter(
			bar as unknown as import("vscode").StatusBarItem,
		);
		return { bar, reporter };
	}

	const slow = makeNetwork({ latency: 500 });
	const healthy = makeNetwork({ latency: 50 });

	it("does not warn if slow polls never reach the debounce threshold", () => {
		const { bar, reporter } = setup(100);
		reporter.update(slow, false);
		reporter.update(slow, false);
		reporter.update(healthy, false);
		reporter.update(healthy, false);
		expect(bar.backgroundColor).toBeUndefined();
		expect(bar.command).toBeUndefined();
	});

	it("stays warning if a single healthy poll appears mid-streak", () => {
		const { bar, reporter } = setup(100);
		for (let i = 0; i < 3; i++) {
			reporter.update(slow, false);
		}
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);

		reporter.update(healthy, false);
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);

		reporter.update(slow, false);
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);
	});

	it("clears immediately when Coder Connect takes over", () => {
		const { bar, reporter } = setup(100);
		for (let i = 0; i < 3; i++) {
			reporter.update(slow, false);
		}
		expect(bar.backgroundColor).toBeInstanceOf(ThemeColor);

		reporter.update(makeNetwork({ using_coder_connect: true }), false);
		expect(bar.backgroundColor).toBeUndefined();
		expect(bar.command).toBeUndefined();
	});
});
