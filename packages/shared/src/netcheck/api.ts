import { defineCommand, defineNotification } from "../ipc/protocol";

export type NetcheckSeverity = "ok" | "warning" | "error";

export interface NetcheckHealthMessage {
	code: string;
	message: string;
}

/** Health fields shared by the DERP and interfaces sections of the report. */
export interface NetcheckSectionHealth {
	severity: NetcheckSeverity;
	warnings: NetcheckHealthMessage[];
	error?: string | null;
}

export interface NetcheckNodeReport {
	severity: NetcheckSeverity;
	can_exchange_messages: boolean;
	round_trip_ping_ms: number;
	uses_websocket: boolean;
	/** Field names match the CLI's Go JSON output, which has no tags here. */
	stun: { Enabled: boolean; CanSTUN: boolean };
	/** Field names match tailscale's DERP map JSON. */
	node?: { STUNOnly?: boolean | null } | null;
}

export interface NetcheckRegionReport {
	severity: NetcheckSeverity;
	error?: string | null;
	/** Field names match tailscale's DERP map JSON. */
	region?: {
		RegionID: number;
		RegionName: string;
		EmbeddedRelay: boolean;
	} | null;
	node_reports: NetcheckNodeReport[];
}

/** Subset of tailscale's netcheck report; field names match its JSON output. */
export interface NetcheckConnectivity {
	UDP: boolean;
	IPv4: boolean;
	IPv6: boolean;
	MappingVariesByDestIP?: boolean | null;
	HairPinning?: boolean | null;
	UPnP?: boolean | null;
	PMP?: boolean | null;
	PCP?: boolean | null;
	/** Region ID of the preferred DERP region; 0 when undetermined. */
	PreferredDERP: number;
	/** Latency per DERP region ID, in nanoseconds. */
	RegionLatency: Record<string, number>;
}

export interface NetcheckInterface {
	name: string;
	mtu: number;
	addresses: string[];
}

/** Subset of the CLI's ClientNetcheckReport that the extension renders. */
export interface NetcheckReport {
	derp: NetcheckSectionHealth & {
		regions: Record<string, NetcheckRegionReport>;
		netcheck?: NetcheckConnectivity | null;
		netcheck_err?: string | null;
	};
	interfaces: NetcheckSectionHealth & {
		interfaces: NetcheckInterface[];
	};
}

export interface NetcheckData {
	/** Hostname of the deployment the report was generated against. */
	host: string;
	report: NetcheckReport;
}

const SEVERITY_RANK: Record<NetcheckSeverity, number> = {
	ok: 0,
	warning: 1,
	error: 2,
};

/** Worst severity across the DERP and interfaces sections. */
export function overallNetcheckSeverity(
	report: NetcheckReport,
): NetcheckSeverity {
	const { derp, interfaces } = report;
	return SEVERITY_RANK[derp.severity] >= SEVERITY_RANK[interfaces.severity]
		? derp.severity
		: interfaces.severity;
}

export const NetcheckApi = {
	/** Extension pushes the parsed report to the webview */
	data: defineNotification<NetcheckData>("netcheck/data"),
	/** Webview signals that its message subscription is active */
	ready: defineCommand<void>("netcheck/ready"),
	/** Webview requests to open raw JSON in a text editor */
	viewJson: defineCommand<void>("netcheck/viewJson"),
} as const;
