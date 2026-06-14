import { nanosToMs, type TriState } from "./format";

import type {
	NetcheckRegionReport,
	NetcheckReport,
	NetcheckSeverity,
} from "@repo/shared";

export interface RegionRow {
	name: string;
	severity: NetcheckSeverity;
	latencyMs: number | undefined;
	preferred: boolean;
	embeddedRelay: boolean;
	stun: TriState;
	relay: TriState;
	error: string | undefined;
}

export function regionName(
	region: NetcheckRegionReport | undefined,
	id: number,
): string {
	return region?.region?.RegionName || `Region ${id}`;
}

/** Rows for the regions table: preferred first, then by latency, then name. */
export function buildRegionRows(report: NetcheckReport): RegionRow[] {
	const probe = report.derp.netcheck;
	return Object.entries(report.derp.regions)
		.map(([key, region]) =>
			toRegionRow(
				region,
				Number(key),
				probe?.PreferredDERP,
				probe?.RegionLatency[key],
			),
		)
		.toSorted(compareRegionRows);
}

function toRegionRow(
	region: NetcheckRegionReport,
	id: number,
	preferredId: number | undefined,
	latencyNanos: number | undefined,
): RegionRow {
	// STUN and relay capability come from different node sets.
	const relayNodes = region.node_reports.filter(
		(n) => !(n.node?.STUNOnly ?? false),
	);
	const stunNodes = region.node_reports.filter((n) => n.stun.Enabled);
	return {
		name: regionName(region, id),
		severity: region.severity,
		latencyMs: regionLatencyMs(latencyNanos, relayNodes),
		preferred: id === preferredId,
		embeddedRelay: region.region?.EmbeddedRelay ?? false,
		stun: anyTriState(stunNodes, (n) => n.stun.CanSTUN),
		relay: anyTriState(relayNodes, (n) => n.can_exchange_messages),
		error: region.error ?? undefined,
	};
}

function regionLatencyMs(
	probedNanos: number | undefined,
	relayNodes: Array<{ round_trip_ping_ms: number }>,
): number | undefined {
	if (probedNanos !== undefined && probedNanos > 0) {
		return nanosToMs(probedNanos);
	}
	const pings = relayNodes
		.map((n) => n.round_trip_ping_ms)
		.filter((ms) => ms > 0);
	return pings.length > 0 ? Math.min(...pings) : undefined;
}

function anyTriState<T>(items: T[], check: (item: T) => boolean): TriState {
	if (items.length === 0) {
		return "unknown";
	}
	return items.some(check) ? "yes" : "no";
}

function compareRegionRows(a: RegionRow, b: RegionRow): number {
	if (a.preferred !== b.preferred) {
		return a.preferred ? -1 : 1;
	}
	// Missing latencies sort last; the `!==` guard avoids Infinity - Infinity
	// (NaN), letting two unmeasured regions fall through to name order.
	const aLatency = a.latencyMs ?? Infinity;
	const bLatency = b.latencyMs ?? Infinity;
	if (aLatency !== bLatency) {
		return aLatency - bLatency;
	}
	return a.name.localeCompare(b.name);
}
