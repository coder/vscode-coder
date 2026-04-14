import { describe, expect, it } from "vitest";

import {
	buildNetworkTooltip,
	checkThresholdViolations,
	getWarningCommand,
	hasAnyViolation,
	type ThresholdViolations,
} from "@/remote/networkStatus";

import type { NetworkInfo } from "@/remote/sshProcess";

function makeNetwork(overrides: Partial<NetworkInfo> = {}): NetworkInfo {
	return {
		p2p: true,
		latency: 50,
		preferred_derp: "NYC",
		derp_latency: { NYC: 10 },
		upload_bytes_sec: 1_250_000, // 10 Mbps
		download_bytes_sec: 6_250_000, // 50 Mbps
		using_coder_connect: false,
		...overrides,
	};
}

const defaultThresholds = { latencyMs: 200, downloadMbps: 5, uploadMbps: 0 };

const noViolations: ThresholdViolations = {
	latency: false,
	download: false,
	upload: false,
};

function tooltip(
	overrides: Partial<NetworkInfo> = {},
	options: {
		violations?: ThresholdViolations;
		thresholds?: {
			latencyMs: number;
			downloadMbps: number;
			uploadMbps: number;
		};
	} = {},
) {
	return buildNetworkTooltip(
		makeNetwork(overrides),
		options.violations ?? noViolations,
		options.thresholds ?? defaultThresholds,
	);
}

describe("checkThresholdViolations", () => {
	interface TestCase {
		desc: string;
		network: Partial<NetworkInfo>;
		thresholds?: typeof defaultThresholds;
		expected: ThresholdViolations;
	}

	it.each<TestCase>([
		{
			desc: "no violations when within thresholds",
			network: {},
			expected: { latency: false, download: false, upload: false },
		},
		{
			desc: "detects high latency",
			network: { latency: 250 },
			expected: { latency: true, download: false, upload: false },
		},
		{
			desc: "detects low download (4 Mbps < 5 Mbps threshold)",
			network: { download_bytes_sec: 500_000 },
			expected: { latency: false, download: true, upload: false },
		},
		{
			desc: "detects low upload when threshold enabled",
			network: { upload_bytes_sec: 100_000 },
			thresholds: { ...defaultThresholds, uploadMbps: 1 },
			expected: { latency: false, download: false, upload: true },
		},
		{
			desc: "ignores upload when threshold is 0",
			network: { upload_bytes_sec: 0 },
			expected: { latency: false, download: false, upload: false },
		},
		{
			desc: "ignores latency when threshold is 0",
			network: { latency: 9999 },
			thresholds: { ...defaultThresholds, latencyMs: 0 },
			expected: { latency: false, download: false, upload: false },
		},
		{
			desc: "detects multiple simultaneous violations",
			network: { latency: 300, download_bytes_sec: 100_000 },
			expected: { latency: true, download: true, upload: false },
		},
	])("$desc", ({ network, thresholds, expected }) => {
		expect(
			checkThresholdViolations(
				makeNetwork(network),
				thresholds ?? defaultThresholds,
			),
		).toEqual(expected);
	});

	it("handles exact boundary (5 Mbps = 625,000 bytes/sec)", () => {
		const at = checkThresholdViolations(
			makeNetwork({ download_bytes_sec: 625_000 }),
			defaultThresholds,
		);
		expect(at.download).toBe(false);

		const below = checkThresholdViolations(
			makeNetwork({ download_bytes_sec: 624_999 }),
			defaultThresholds,
		);
		expect(below.download).toBe(true);
	});
});

describe("hasAnyViolation", () => {
	it.each<{ violations: ThresholdViolations; expected: boolean }>([
		{
			violations: { latency: false, download: false, upload: false },
			expected: false,
		},
		{
			violations: { latency: true, download: false, upload: false },
			expected: true,
		},
		{
			violations: { latency: false, download: true, upload: false },
			expected: true,
		},
		{
			violations: { latency: false, download: false, upload: true },
			expected: true,
		},
	])("returns $expected for %j", ({ violations, expected }) => {
		expect(hasAnyViolation(violations)).toBe(expected);
	});
});

describe("getWarningCommand", () => {
	it.each<{ desc: string; violations: ThresholdViolations; expected: string }>([
		{
			desc: "ping for latency only",
			violations: { latency: true, download: false, upload: false },
			expected: "coder.pingWorkspace",
		},
		{
			desc: "speedtest for download only",
			violations: { latency: false, download: true, upload: false },
			expected: "coder.speedTest",
		},
		{
			desc: "speedtest for upload only",
			violations: { latency: false, download: false, upload: true },
			expected: "coder.speedTest",
		},
		{
			desc: "speedtest for download + upload",
			violations: { latency: false, download: true, upload: true },
			expected: "coder.speedTest",
		},
		{
			desc: "diagnostics for latency + throughput",
			violations: { latency: true, download: true, upload: false },
			expected: "coder.showNetworkDiagnostics",
		},
		{
			desc: "diagnostics for all violations",
			violations: { latency: true, download: true, upload: true },
			expected: "coder.showNetworkDiagnostics",
		},
	])("returns $expected for $desc", ({ violations, expected }) => {
		expect(getWarningCommand(violations)).toBe(expected);
	});
});

describe("buildNetworkTooltip", () => {
	it("shows all metrics without warnings in normal state", () => {
		const t = tooltip();
		expect(t.value).toContain("Latency: 50.00ms");
		expect(t.value).toContain("Download: 50 Mbit/s");
		expect(t.value).toContain("Upload: 10 Mbit/s");
		expect(t.value).not.toContain("$(warning)");
		expect(t.value).not.toContain("Click for diagnostics");
		expect(t.value).not.toContain("Configure thresholds");
	});

	it("shows warning markers and actions when thresholds violated", () => {
		const violations: ThresholdViolations = {
			latency: true,
			download: false,
			upload: false,
		};
		const t = tooltip({ latency: 350 }, { violations });
		expect(t.value).toContain(
			"Latency: 350.00ms $(warning) (threshold: 200ms)",
		);
		expect(t.value).not.toContain("Download:$(warning)");
		expect(t.value).toContain("Click for diagnostics");
		expect(t.value).toContain("Configure thresholds");
	});

	it("shows multiple warning markers when multiple thresholds crossed", () => {
		const violations: ThresholdViolations = {
			latency: true,
			download: true,
			upload: false,
		};
		const t = tooltip(
			{ latency: 300, download_bytes_sec: 100_000 },
			{ violations },
		);
		expect(t.value).toContain("Latency: 300.00ms $(warning)");
		expect(t.value).toContain("Download: 800 kbit/s $(warning)");
		expect(t.value).toContain("Click for diagnostics");
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
