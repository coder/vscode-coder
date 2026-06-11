import { z } from "zod";

import type { NetcheckReport } from "@repo/shared";

const SeveritySchema = z.enum(["ok", "warning", "error"]);

const HealthMessageSchema = z.object({
	code: z.string(),
	message: z.string(),
});

/** The CLI emits `null` instead of `[]` for empty warning lists. */
const WarningsSchema = z
	.array(HealthMessageSchema)
	.nullish()
	.transform((v) => v ?? []);

const NodeReportSchema = z.object({
	severity: SeveritySchema,
	can_exchange_messages: z.boolean(),
	round_trip_ping_ms: z.number(),
	uses_websocket: z.boolean(),
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
	node_reports: z
		.array(NodeReportSchema)
		.nullish()
		.transform((v) => v ?? []),
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
			.transform((v) =>
				Object.fromEntries(
					Object.entries(v ?? {}).filter(
						([, region]) => region !== null,
					) as Array<[string, z.output<typeof RegionReportSchema>]>,
				),
			),
		netcheck: ConnectivitySchema.nullish(),
		netcheck_err: z.string().nullish(),
	}),
	interfaces: z.object({
		severity: SeveritySchema,
		warnings: WarningsSchema,
		error: z.string().nullish(),
		interfaces: z
			.array(InterfaceSchema)
			.nullish()
			.transform((v) => v ?? []),
	}),
});

export function parseNetcheckReport(json: string): NetcheckReport {
	return NetcheckReportSchema.parse(JSON.parse(json)) satisfies NetcheckReport;
}
