import type { OtlpGaugePoint, OtlpMetric, OtlpSumPoint } from "./types";

interface BufferedMetricSeries {
	/** First record seen for the series; carries name/description/unit and sum metadata. */
	readonly template: OtlpMetric;
	readonly gaugePoints: OtlpGaugePoint[];
	readonly sumPoints: OtlpSumPoint[];
}

/**
 * Groups single-point metric records into one `metrics[]` entry per
 * (name, unit, kind), as the OTLP metrics proto expects. The writer drains
 * the buffer at block boundaries and at a point cap, bounding memory.
 */
export class MetricBlockBuffer {
	readonly #series = new Map<string, BufferedMetricSeries>();
	#points = 0;

	/** Buffered data point count across all series. */
	get points(): number {
		return this.#points;
	}

	add(records: readonly OtlpMetric[]): void {
		for (const record of records) {
			const kind = record.gauge !== undefined ? "gauge" : "sum";
			const key = `${record.name}\x00${record.unit}\x00${kind}`;
			let series = this.#series.get(key);
			if (series === undefined) {
				series = { template: record, gaugePoints: [], sumPoints: [] };
				this.#series.set(key, series);
			}
			series.gaugePoints.push(...(record.gauge?.dataPoints ?? []));
			series.sumPoints.push(...(record.sum?.dataPoints ?? []));
			this.#points +=
				(record.gauge?.dataPoints.length ?? 0) +
				(record.sum?.dataPoints.length ?? 0);
		}
	}

	/** Returns the grouped metrics in first-seen order and clears the buffer. */
	drain(): OtlpMetric[] {
		const drained = [...this.#series.values()].map(
			({ template, gaugePoints, sumPoints }): OtlpMetric =>
				template.sum !== undefined
					? { ...template, sum: { ...template.sum, dataPoints: sumPoints } }
					: { ...template, gauge: { dataPoints: gaugePoints } },
		);
		this.#series.clear();
		this.#points = 0;
		return drained;
	}
}
