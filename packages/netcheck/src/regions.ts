import { nanosToMs, type TriState } from "./format";

import type {
	NetcheckRegionReport,
	NetcheckReport,
	NetcheckSeverity,
} from "@repo/shared";

export interface RegionRow {
	id: number;
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
	const latencies = report.derp.netcheck?.RegionLatency ?? {};
	const preferredId = report.derp.netcheck?.PreferredDERP;
	const rows = Object.entries(report.derp.regions).map(([key, region]) => {
		const id = Number(key);
		const nodes = region.node_reports;
		const stunNodes = nodes.filter((n) => n.stun.Enabled);
		const relayNodes = nodes.filter((n) => !(n.node?.STUNOnly ?? false));
		return {
			id,
			name: regionName(region, id),
			severity: region.severity,
			latencyMs: regionLatencyMs(latencies[key], relayNodes),
			preferred: id === preferredId,
			embeddedRelay: region.region?.EmbeddedRelay ?? false,
			stun: anyTriState(stunNodes, (n) => n.stun.CanSTUN),
			relay: anyTriState(relayNodes, (n) => n.can_exchange_messages),
			error: region.error ?? undefined,
		};
	});
	return rows.sort(compareRegionRows);
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
	const aHasLatency = a.latencyMs !== undefined;
	const bHasLatency = b.latencyMs !== undefined;
	if (aHasLatency !== bHasLatency) {
		return aHasLatency ? -1 : 1;
	}
	if (
		a.latencyMs !== undefined &&
		b.latencyMs !== undefined &&
		a.latencyMs !== b.latencyMs
	) {
		return a.latencyMs - b.latencyMs;
	}
	return a.name.localeCompare(b.name);
}
