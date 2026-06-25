import { z } from "zod";

import { worstSeverity, type NetcheckReport } from "@repo/shared";

import type {
	DERPHealthReport,
	DERPNodeReport,
	DERPRegionReport,
	NetcheckReport as TailscaleNetcheckReport,
} from "coder/site/src/api/typesGenerated";

/**
 * The coder SDK fields the parser reads, as a compile-time drift guard: an
 * upstream rename or removal fails the build. (Leaf type changes are caught at
 * runtime by the schema; the `interfaces` section has no SDK type.)
 */
type _NetcheckSdkFields =
	| keyof Pick<
			DERPHealthReport,
			| "severity"
			| "warnings"
			| "error"
			| "regions"
			| "netcheck"
			| "netcheck_err"
	  >
	| keyof Pick<
			DERPRegionReport,
			"severity" | "error" | "region" | "node_reports"
	  >
	| keyof Pick<
			DERPNodeReport,
			"can_exchange_messages" | "round_trip_ping_ms" | "stun" | "node"
	  >
	| keyof Pick<
			TailscaleNetcheckReport,
			| "UDP"
			| "IPv4"
			| "IPv6"
			| "MappingVariesByDestIP"
			| "HairPinning"
			| "UPnP"
			| "PMP"
			| "PCP"
			| "PreferredDERP"
			| "RegionLatency"
	  >;

const SeveritySchema = z.enum(["ok", "warning", "error"]);

/** The CLI emits `null` instead of `[]` for empty lists. */
function emptyIfNull<T extends z.ZodType>(item: T) {
	return z
		.array(item)
		.nullish()
		.transform((v) => v ?? []);
}

const HealthMessageSchema = z.object({
	code: z.string(),
	message: z.string(),
});

const WarningsSchema = emptyIfNull(HealthMessageSchema);

const NodeReportSchema = z.object({
	can_exchange_messages: z.boolean(),
	round_trip_ping_ms: z.number(),
	stun: z.object({
		Enabled: z.boolean(),
		CanSTUN: z.boolean(),
	}),
	node: z
		.object({ STUNOnly: z.boolean().nullish() })
		.nullish()
		.transform((v) => v ?? undefined),
});

const RegionReportSchema = z
	.object({
		severity: SeveritySchema,
		error: z.string().nullish(),
		region: z
			.object({
				RegionID: z.number(),
				RegionName: z.string(),
				EmbeddedRelay: z.boolean(),
			})
			.nullish(),
		node_reports: emptyIfNull(NodeReportSchema),
	})
	// Fold error into severity so the banner, summary, cell, and telemetry agree.
	.transform((r) => ({ ...r, severity: r.error ? "error" : r.severity }));

const ConnectivitySchema = z.object({
	UDP: z.boolean(),
	IPv4: z.boolean(),
	IPv6: z.boolean(),
	MappingVariesByDestIP: z.boolean().nullish(),
	HairPinning: z.boolean().nullish(),
	UPnP: z.boolean().nullish(),
	PMP: z.boolean().nullish(),
	PCP: z.boolean().nullish(),
	PreferredDERP: z.number(),
	RegionLatency: z
		.record(z.string(), z.number())
		.nullish()
		.transform((v) => v ?? {}),
});

const InterfaceSchema = z.object({
	name: z.string(),
	mtu: z.number(),
	addresses: z.array(z.string()),
});

const NetcheckReportSchema = z.object({
	derp: z
		.object({
			severity: SeveritySchema,
			warnings: WarningsSchema,
			error: z.string().nullish(),
			// Region values are nullable pointers in the CLI; drop null entries.
			regions: z
				.record(z.string(), RegionReportSchema.nullable())
				.nullish()
				.transform((v) => {
					const regions: Record<
						string,
						z.output<typeof RegionReportSchema>
					> = {};
					for (const [id, region] of Object.entries(v ?? {})) {
						if (region !== null) {
							regions[id] = region;
						}
					}
					return regions;
				}),
			netcheck: ConnectivitySchema.nullish(),
			netcheck_err: z.string().nullish(),
		})
		// Roll a failed probe and the worst region up into the section severity.
		.transform((d) => ({
			...d,
			severity: worstSeverity([
				d.netcheck_err || d.error ? "error" : d.severity,
				...Object.values(d.regions).map((r) => r.severity),
			]),
		})),
	interfaces: z
		.object({
			severity: SeveritySchema,
			warnings: WarningsSchema,
			error: z.string().nullish(),
			interfaces: emptyIfNull(InterfaceSchema),
		})
		.transform((i) => ({ ...i, severity: i.error ? "error" : i.severity })),
});

export function parseNetcheckReport(json: string): NetcheckReport {
	return NetcheckReportSchema.parse(JSON.parse(json));
}
