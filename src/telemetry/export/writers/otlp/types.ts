/**
 * Local TypeScript shapes for the OTLP/JSON wire format. The upstream types in
 * `@opentelemetry/otlp-transformer` drag in the whole OTel SDK for runtime
 * exporters we don't use, so we mirror the slice of the proto schema we
 * serialize and stay SDK-free.
 *
 * Spec (opentelemetry-proto v1.10.0):
 * https://github.com/open-telemetry/opentelemetry-proto/tree/ca839c51f706f5d53bfb46f06c3e90c3af3a52c6/opentelemetry/proto
 */

export interface OtlpKeyValue {
	readonly key: string;
	readonly value:
		{ readonly stringValue: string } | { readonly doubleValue: number };
}

export interface OtlpLogRecord {
	readonly timeUnixNano: string;
	readonly observedTimeUnixNano: string;
	readonly severityNumber: number;
	readonly severityText: string;
	readonly body: { readonly stringValue: string };
	readonly attributes: readonly OtlpKeyValue[];
	/** Set on span-attached logs to link the record to its parent span. */
	readonly traceId?: string;
	readonly spanId?: string;
}

export interface OtlpStatus {
	readonly code: number;
	readonly message?: string;
}

export interface OtlpSpanEvent {
	readonly name: string;
	readonly timeUnixNano: string;
	readonly attributes: readonly OtlpKeyValue[];
}

export interface OtlpSpan {
	readonly traceId: string;
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly name: string;
	readonly kind: number;
	readonly startTimeUnixNano: string;
	readonly endTimeUnixNano: string;
	readonly attributes: readonly OtlpKeyValue[];
	readonly status: OtlpStatus;
	readonly events?: readonly OtlpSpanEvent[];
}

export interface OtlpGaugePoint {
	readonly attributes: readonly OtlpKeyValue[];
	readonly startTimeUnixNano?: string;
	readonly timeUnixNano: string;
	readonly asDouble: number;
}

export interface OtlpSumPoint {
	readonly attributes: readonly OtlpKeyValue[];
	readonly startTimeUnixNano: string;
	readonly timeUnixNano: string;
	readonly asInt: string;
}

export interface OtlpMetric {
	readonly name: string;
	readonly description: string;
	readonly unit: string;
	readonly gauge?: { readonly dataPoints: readonly OtlpGaugePoint[] };
	readonly sum?: {
		readonly aggregationTemporality: number;
		readonly isMonotonic: boolean;
		readonly dataPoints: readonly OtlpSumPoint[];
	};
}
