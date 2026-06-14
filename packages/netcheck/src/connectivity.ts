import { regionName } from "./regions";

import type { NetcheckConnectivity, NetcheckReport } from "@repo/shared";

/** Maps to a `tone-*` CSS class so color lives in the stylesheet, not here. */
export type Tone = "good" | "bad" | "warn" | "neutral";

export interface ConnectivityItem {
	label: string;
	value: string;
	tone: Tone;
}

type Outcome = [value: string, tone: Tone];

/** Connectivity facts derived from the embedded tailscale netcheck probe. */
export function buildConnectivityItems(
	report: NetcheckReport,
): ConnectivityItem[] {
	const probe = report.derp.netcheck;
	if (!probe) {
		return [];
	}

	// Tones: bad = real problem, warn = works but suboptimal, neutral = optional.
	// So a missing optional capability stays neutral, but blocked UDP is bad.
	const items: ConnectivityItem[] = [
		boolItem("UDP", probe.UDP, ["Reachable", "good"], ["Blocked", "bad"]),
		boolItem("IPv4", probe.IPv4, ["Yes", "good"], ["No", "bad"]),
		boolItem("IPv6", probe.IPv6, ["Yes", "good"], ["No", "neutral"]),
		boolItem(
			"NAT mapping",
			probe.MappingVariesByDestIP,
			["Varies by destination (hard NAT)", "warn"],
			["Consistent (easy NAT)", "good"],
		),
		boolItem(
			"Hairpinning",
			probe.HairPinning,
			["Supported", "good"],
			["Not supported", "neutral"],
		),
		portMappingItem(probe),
	];

	const preferred = preferredRegionName(report);
	if (preferred) {
		items.push({ label: "Preferred relay", value: preferred, tone: "good" });
	}
	return items;
}

/** Picks the true/false outcome; null/undefined render as a neutral "Unknown". */
function boolItem(
	label: string,
	state: boolean | null | undefined,
	ifTrue: Outcome,
	ifFalse: Outcome,
): ConnectivityItem {
	const [value, tone]: Outcome =
		state === true
			? ifTrue
			: state === false
				? ifFalse
				: ["Unknown", "neutral"];
	return { label, value, tone };
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
