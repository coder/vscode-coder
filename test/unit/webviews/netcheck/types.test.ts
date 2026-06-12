import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { parseNetcheckReport } from "@/webviews/netcheck/types";

/** Trimmed version of a real `coder netcheck` report. */
const validReport = {
	derp: {
		severity: "ok",
		warnings: [],
		dismissed: false,
		healthy: true,
		regions: {
			"999": {
				healthy: true,
				severity: "ok",
				warnings: [],
				region: {
					EmbeddedRelay: true,
					RegionID: 999,
					RegionCode: "coder",
					RegionName: "Council Bluffs, Iowa",
					Nodes: [
						{
							Name: "999b",
							RegionID: 999,
							HostName: "dev.coder.com",
							STUNPort: -1,
							STUNOnly: false,
							DERPPort: 443,
						},
					],
				},
				node_reports: [
					{
						healthy: true,
						severity: "ok",
						warnings: [],
						node: {
							Name: "999b",
							RegionID: 999,
							HostName: "dev.coder.com",
							STUNPort: -1,
							STUNOnly: false,
							DERPPort: 443,
						},
						node_info: {
							TokenBucketBytesPerSecond: 0,
							TokenBucketBytesBurst: 0,
						},
						can_exchange_messages: true,
						round_trip_ping: "60ms",
						round_trip_ping_ms: 60,
						uses_websocket: false,
						client_logs: [[], []],
						client_errs: [[], []],
						stun: { Enabled: false, CanSTUN: false, Error: null },
					},
				],
			},
			"1000": {
				healthy: true,
				severity: "ok",
				warnings: [],
				region: {
					EmbeddedRelay: false,
					RegionID: 1000,
					RegionCode: "coder_stun_1000",
					RegionName: "Coder STUN 1000",
					Nodes: [
						{
							Name: "1000stun0",
							RegionID: 1000,
							HostName: "stun.l.google.com",
							STUNPort: 19302,
							STUNOnly: true,
						},
					],
				},
				node_reports: [
					{
						healthy: true,
						severity: "ok",
						warnings: [],
						node: {
							Name: "1000stun0",
							RegionID: 1000,
							HostName: "stun.l.google.com",
							STUNPort: 19302,
							STUNOnly: true,
						},
						node_info: {
							TokenBucketBytesPerSecond: 0,
							TokenBucketBytesBurst: 0,
						},
						can_exchange_messages: false,
						round_trip_ping: "",
						round_trip_ping_ms: 0,
						uses_websocket: false,
						client_logs: [],
						client_errs: [],
						stun: { Enabled: true, CanSTUN: true, Error: null },
					},
				],
			},
		},
		netcheck: {
			UDP: true,
			IPv6: false,
			IPv4: true,
			IPv6CanSend: false,
			IPv4CanSend: true,
			OSHasIPv6: true,
			ICMPv4: false,
			MappingVariesByDestIP: false,
			HairPinning: null,
			UPnP: false,
			PMP: false,
			PCP: false,
			PreferredDERP: 999,
			RegionLatency: { "999": 27706829, "1000": 28003498 },
			RegionV4Latency: { "999": 27706829 },
			RegionV6Latency: {},
			GlobalV4: "64.130.54.176:56069",
			GlobalV6: "",
			CaptivePortal: null,
		},
		netcheck_logs: [],
	},
	interfaces: {
		severity: "ok",
		// The CLI emits null rather than [] when there are no warnings.
		warnings: null,
		dismissed: false,
		interfaces: [
			{ name: "lo", mtu: 65536, addresses: ["127.0.0.1/8", "::1/128"] },
			{ name: "eth0", mtu: 1500, addresses: ["172.20.0.99/16"] },
		],
	},
};

describe("parseNetcheckReport", () => {
	it("parses a realistic CLI payload", () => {
		const report = parseNetcheckReport(JSON.stringify(validReport));

		expect(report.derp.severity).toBe("ok");
		expect(Object.keys(report.derp.regions)).toEqual(["999", "1000"]);
		expect(report.derp.regions["999"].region?.RegionName).toBe(
			"Council Bluffs, Iowa",
		);
		expect(report.derp.regions["999"].node_reports[0].round_trip_ping_ms).toBe(
			60,
		);
		expect(report.derp.netcheck?.PreferredDERP).toBe(999);
		expect(report.derp.netcheck?.RegionLatency["999"]).toBe(27706829);
		expect(report.interfaces.interfaces).toHaveLength(2);
	});

	it("normalizes null warning lists to empty arrays", () => {
		const report = parseNetcheckReport(JSON.stringify(validReport));
		expect(report.interfaces.warnings).toEqual([]);
		expect(report.derp.warnings).toEqual([]);
	});

	it("drops null region entries", () => {
		const withNullRegion = structuredClone(validReport) as Record<
			string,
			unknown
		> & { derp: { regions: Record<string, unknown> } };
		withNullRegion.derp.regions["1001"] = null;

		const report = parseNetcheckReport(JSON.stringify(withNullRegion));
		expect(Object.keys(report.derp.regions)).toEqual(["999", "1000"]);
	});

	it("tolerates a missing netcheck probe section", () => {
		const withoutProbe = structuredClone(validReport) as {
			derp: { netcheck?: unknown; netcheck_err?: string };
		};
		delete withoutProbe.derp.netcheck;
		withoutProbe.derp.netcheck_err = "probe failed";

		const report = parseNetcheckReport(JSON.stringify(withoutProbe));
		expect(report.derp.netcheck).toBeUndefined();
		expect(report.derp.netcheck_err).toBe("probe failed");
	});

	it("preserves warning codes and messages", () => {
		const withWarnings = structuredClone(validReport) as {
			derp: { severity: string; warnings: unknown[] };
		};
		withWarnings.derp.severity = "warning";
		withWarnings.derp.warnings = [
			{ code: "EDERP01", message: "Region latency is high" },
		];

		const report = parseNetcheckReport(JSON.stringify(withWarnings));
		expect(report.derp.warnings).toEqual([
			{ code: "EDERP01", message: "Region latency is high" },
		]);
	});

	it("throws ZodError when a required field is missing", () => {
		const missingSeverity = structuredClone(validReport) as {
			derp: { severity?: string };
		};
		delete missingSeverity.derp.severity;
		expect(() => parseNetcheckReport(JSON.stringify(missingSeverity))).toThrow(
			ZodError,
		);
	});

	it("throws ZodError when a field has the wrong type", () => {
		const wrongType = structuredClone(validReport) as {
			derp: { netcheck: { UDP: unknown } };
		};
		wrongType.derp.netcheck.UDP = "yes";
		expect(() => parseNetcheckReport(JSON.stringify(wrongType))).toThrow(
			ZodError,
		);
	});

	it("throws SyntaxError on malformed JSON", () => {
		expect(() => parseNetcheckReport("not json")).toThrow(SyntaxError);
	});
});
