import type { TelemetryEvent } from "../event";

export type ExportTelemetryEvent = TelemetryEvent;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { readonly [key: string]: JsonValue };
