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
	const items: ConnectivityItem[] = [
		boolItem("UDP", probe.UDP, {
			true: ["Reachable", "good"],
			false: ["Blocked", "bad"],
		}),
		boolItem("IPv4", probe.IPv4, {
			true: ["Yes", "good"],
			false: ["No", "warn"],
		}),
		boolItem("IPv6", probe.IPv6, {
			true: ["Yes", "good"],
			false: ["No", "neutral"],
		}),
		boolItem("NAT mapping", probe.MappingVariesByDestIP, {
			true: ["Varies by destination (hard NAT)", "warn"],
			false: ["Consistent (easy NAT)", "good"],
		}),
		boolItem("Hairpinning", probe.HairPinning, {
			true: ["Supported", "good"],
			false: ["Not supported", "neutral"],
		}),
		portMappingItem(probe),
	];

	const preferred = preferredRegionName(report);
	if (preferred) {
		items.push({ label: "Preferred relay", value: preferred, tone: "good" });
	}
	return items;
}

/** Renders a boolean probe field; a missing value is a neutral "Unknown". */
function boolItem(
	label: string,
	state: boolean | null | undefined,
	cases: { true: Outcome; false: Outcome },
): ConnectivityItem {
	if (typeof state !== "boolean") {
		return { label, value: "Unknown", tone: "neutral" };
	}
	const [value, tone] = state ? cases.true : cases.false;
	return { label, value, tone };
}

function portMappingItem(probe: NetcheckConnectivity): ConnectivityItem {
	const fields = [
		[probe.UPnP, "UPnP"],
		[probe.PMP, "NAT-PMP"],
		[probe.PCP, "PCP"],
	] as const;
	const detected = fields.filter(([on]) => on).map(([, name]) => name);
	if (detected.length > 0) {
		return { label: "Port mapping", value: detected.join(", "), tone: "good" };
	}
	// A null field means "could not determine", so report "None detected" only
	// once a protocol was actually probed.
	const probed = fields.some(([on]) => typeof on === "boolean");
	return {
		label: "Port mapping",
		value: probed ? "None detected" : "Unknown",
		tone: "neutral",
	};
}

function preferredRegionName(report: NetcheckReport): string | undefined {
	const id = report.derp.netcheck?.PreferredDERP;
	if (!id) {
		return undefined;
	}
	return regionName(report.derp.regions[String(id)], id);
}
