/**
 * Domain types for a `coder netcheck` report: the fields the webview renders,
 * normalized during parsing (null regions dropped, null lists become `[]`). The
 * DERP section mirrors codersdk `DERPHealthReport`. CLI/tailscale JSON field
 * names are kept as-is; types we add like NetcheckData use camelCase.
 */

export type NetcheckSeverity = "ok" | "warning" | "error";

/** Health fields shared by the DERP and interfaces sections of the report. */
export interface NetcheckSectionHealth {
	severity: NetcheckSeverity;
	warnings: Array<{ code: string; message: string }>;
	error?: string | null;
}

interface NetcheckNodeReport {
	can_exchange_messages: boolean;
	round_trip_ping_ms: number;
	stun: { Enabled: boolean; CanSTUN: boolean };
	node?: { STUNOnly?: boolean | null } | null;
}

export interface NetcheckRegionReport {
	severity: NetcheckSeverity;
	error?: string | null;
	region?: {
		RegionID: number;
		RegionName: string;
		EmbeddedRelay: boolean;
	} | null;
	node_reports: NetcheckNodeReport[];
}

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
