import { z } from "zod";

import type { SpeedtestResult } from "@repo/shared";

const SpeedtestIntervalSchema = z.object({
	start_time_seconds: z.number(),
	end_time_seconds: z.number(),
	throughput_mbits: z.number(),
});

const SpeedtestResultSchema = z.object({
	overall: SpeedtestIntervalSchema,
	intervals: z.array(SpeedtestIntervalSchema),
}) satisfies z.ZodType<SpeedtestResult>;

export function parseSpeedtestResult(json: string): SpeedtestResult {
	return SpeedtestResultSchema.parse(JSON.parse(json));
}
