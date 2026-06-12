import { regionName } from "./regions";

import type { NetcheckConnectivity, NetcheckReport } from "@repo/shared";

/** Visual emphasis for a connectivity value. */
export type Tone = "good" | "bad" | "warn" | "neutral";

export interface ConnectivityItem {
	label: string;
	value: string;
	tone: Tone;
}

type ItemDisplay = Omit<ConnectivityItem, "label">;

/** Connectivity facts derived from the embedded tailscale netcheck probe. */
export function buildConnectivityItems(
	report: NetcheckReport,
): ConnectivityItem[] {
	const probe = report.derp.netcheck;
	if (!probe) {
		return [];
	}

	const items: ConnectivityItem[] = [
		triItem(
			"UDP",
			probe.UDP,
			{ value: "Reachable", tone: "good" },
			{ value: "Blocked", tone: "bad" },
		),
		triItem(
			"IPv4",
			probe.IPv4,
			{ value: "Yes", tone: "good" },
			{ value: "No", tone: "bad" },
		),
		triItem(
			"IPv6",
			probe.IPv6,
			{ value: "Yes", tone: "good" },
			{ value: "No", tone: "neutral" },
		),
		triItem(
			"NAT mapping",
			probe.MappingVariesByDestIP,
			{ value: "Varies by destination (hard NAT)", tone: "warn" },
			{ value: "Consistent (easy NAT)", tone: "good" },
		),
		triItem(
			"Hairpinning",
			probe.HairPinning,
			{ value: "Supported", tone: "good" },
			{ value: "Not supported", tone: "neutral" },
		),
		portMappingItem(probe),
	];

	const preferred = preferredRegionName(report);
	if (preferred) {
		items.push({ label: "Preferred relay", value: preferred, tone: "good" });
	}
	return items;
}

/** Maps true/false to the given displays; null/undefined render as Unknown. */
function triItem(
	label: string,
	state: boolean | null | undefined,
	whenTrue: ItemDisplay,
	whenFalse: ItemDisplay,
): ConnectivityItem {
	if (state === true) {
		return { label, ...whenTrue };
	}
	if (state === false) {
		return { label, ...whenFalse };
	}
	return { label, value: "Unknown", tone: "neutral" };
}

function portMappingItem(probe: NetcheckConnectivity): ConnectivityItem {
	const protocols = [
		probe.UPnP ? "UPnP" : undefined,
		probe.PMP ? "NAT-PMP" : undefined,
		probe.PCP ? "PCP" : undefined,
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
