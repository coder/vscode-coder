import type {
	NetcheckHealthMessage,
	NetcheckRegionReport,
	NetcheckReport,
	NetcheckSectionHealth,
	NetcheckSeverity,
} from "@repo/shared";

export type TriState = "yes" | "no" | "unknown";

/** Visual emphasis for a connectivity value. */
export type Tone = "good" | "bad" | "warn" | "neutral";

export interface ConnectivityItem {
	label: string;
	value: string;
	tone: Tone;
}

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

export interface Issue {
	kind: "error" | "warning";
	code?: string;
	message: string;
}

export function severityLabel(severity: NetcheckSeverity): string {
	switch (severity) {
		case "ok":
			return "Healthy";
		case "warning":
			return "Warning";
		case "error":
			return "Error";
	}
}

export function bannerTitle(severity: NetcheckSeverity): string {
	switch (severity) {
		case "ok":
			return "Network is healthy";
		case "warning":
			return "Network has warnings";
		case "error":
			return "Network problems detected";
	}
}

/** One-line status for a report section, e.g. "DERP & STUN: 2 warnings". */
export function sectionSummary(
	label: string,
	section: NetcheckSectionHealth,
): string {
	switch (section.severity) {
		case "ok":
			return `${label}: healthy`;
		case "warning": {
			const count = section.warnings.length;
			return count > 0
				? `${label}: ${count} warning${count === 1 ? "" : "s"}`
				: `${label}: warning`;
		}
		case "error":
			return `${label}: error`;
	}
}

/** Section errors first, then warnings, so the most severe issues lead. */
export function collectIssues(report: NetcheckReport): Issue[] {
	const errors: Issue[] = [];
	const warnings: Issue[] = [];
	const addSection = (section: NetcheckSectionHealth) => {
		if (section.error) {
			errors.push({ kind: "error", message: section.error });
		}
		for (const warning of section.warnings) {
			warnings.push({ kind: "warning", ...toIssueParts(warning) });
		}
	};
	addSection(report.derp);
	if (report.derp.netcheck_err) {
		errors.push({ kind: "error", message: report.derp.netcheck_err });
	}
	addSection(report.interfaces);
	return [...errors, ...warnings];
}

function toIssueParts(warning: NetcheckHealthMessage): {
	code?: string;
	message: string;
} {
	return warning.code
		? { code: warning.code, message: warning.message }
		: { message: warning.message };
}

const NANOS_PER_MS = 1_000_000;

export function nanosToMs(nanos: number): number {
	return nanos / NANOS_PER_MS;
}

export function formatLatency(ms: number | undefined): string {
	if (ms === undefined) {
		return "—";
	}
	if (ms < 1) {
		return "<1 ms";
	}
	if (ms < 100) {
		return `${ms.toFixed(1)} ms`;
	}
	return `${Math.round(ms)} ms`;
}

export function formatTriState(
	value: TriState,
	labels: { yes: string; no: string },
): string {
	switch (value) {
		case "yes":
			return labels.yes;
		case "no":
			return labels.no;
		case "unknown":
			return "—";
	}
}

/** Connectivity facts derived from the embedded tailscale netcheck probe. */
export function buildConnectivityItems(
	report: NetcheckReport,
): ConnectivityItem[] {
	const probe = report.derp.netcheck;
	if (!probe) {
		return [];
	}

	const items: ConnectivityItem[] = [
		{
			label: "UDP",
			value: probe.UDP ? "Reachable" : "Blocked",
			tone: probe.UDP ? "good" : "bad",
		},
		{
			label: "IPv4",
			value: probe.IPv4 ? "Yes" : "No",
			tone: probe.IPv4 ? "good" : "bad",
		},
		{
			label: "IPv6",
			value: probe.IPv6 ? "Yes" : "No",
			tone: probe.IPv6 ? "good" : "neutral",
		},
		natMappingItem(probe.MappingVariesByDestIP),
		hairpinningItem(probe.HairPinning),
		portMappingItem(probe.UPnP, probe.PMP, probe.PCP),
	];

	const preferred = preferredRegionName(report);
	if (preferred) {
		items.push({ label: "Preferred relay", value: preferred, tone: "good" });
	}
	return items;
}

function natMappingItem(varies: boolean | null | undefined): ConnectivityItem {
	const label = "NAT mapping";
	if (varies === true) {
		return {
			label,
			value: "Varies by destination (hard NAT)",
			tone: "warn",
		};
	}
	if (varies === false) {
		return { label, value: "Consistent (easy NAT)", tone: "good" };
	}
	return { label, value: "Unknown", tone: "neutral" };
}

function hairpinningItem(
	hairpinning: boolean | null | undefined,
): ConnectivityItem {
	const label = "Hairpinning";
	if (hairpinning === true) {
		return { label, value: "Supported", tone: "good" };
	}
	if (hairpinning === false) {
		return { label, value: "Not supported", tone: "neutral" };
	}
	return { label, value: "Unknown", tone: "neutral" };
}

function portMappingItem(
	upnp: boolean | null | undefined,
	pmp: boolean | null | undefined,
	pcp: boolean | null | undefined,
): ConnectivityItem {
	const protocols = [
		upnp ? "UPnP" : undefined,
		pmp ? "NAT-PMP" : undefined,
		pcp ? "PCP" : undefined,
	].filter((p): p is string => p !== undefined);
	return protocols.length > 0
		? { label: "Port mapping", value: protocols.join(", "), tone: "good" }
		: { label: "Port mapping", value: "None detected", tone: "neutral" };
}

function preferredRegionName(report: NetcheckReport): string | undefined {
	const id = report.derp.netcheck?.PreferredDERP;
	if (!id) {
		return undefined;
	}
	return regionName(report.derp.regions[String(id)], id);
}

function regionName(
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
