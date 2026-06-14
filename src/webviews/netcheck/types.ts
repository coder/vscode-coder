import { z } from "zod";

import type { NetcheckReport } from "@repo/shared";

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

const RegionReportSchema = z.object({
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
});

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
	derp: z.object({
		severity: SeveritySchema,
		warnings: WarningsSchema,
		error: z.string().nullish(),
		// Region values are nullable pointers in the CLI; drop null entries.
		regions: z
			.record(z.string(), RegionReportSchema.nullable())
			.nullish()
			.transform((v) => {
				const regions: Record<string, z.output<typeof RegionReportSchema>> = {};
				for (const [id, region] of Object.entries(v ?? {})) {
					if (region !== null) {
						regions[id] = region;
					}
				}
				return regions;
			}),
		netcheck: ConnectivitySchema.nullish(),
		netcheck_err: z.string().nullish(),
	}),
	interfaces: z.object({
		severity: SeveritySchema,
		warnings: WarningsSchema,
		error: z.string().nullish(),
		interfaces: emptyIfNull(InterfaceSchema),
	}),
});

export function parseNetcheckReport(json: string): NetcheckReport {
	return NetcheckReportSchema.parse(JSON.parse(json)) satisfies NetcheckReport;
}
