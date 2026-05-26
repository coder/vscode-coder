import {
	ENVELOPES,
	type Signal,
} from "@/telemetry/export/writers/otlp/records";

export const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Flatten OTLP `[{key, value: {stringValue|doubleValue}}]` to `{key: value}`. */
export function attrs(raw: unknown): Record<string, string | number> {
	const list = raw as Array<{
		key: string;
		value: { stringValue?: string; doubleValue?: number };
	}>;
	return Object.fromEntries(
		list.map((a) => [a.key, a.value.doubleValue ?? a.value.stringValue!]),
	);
}

export interface ParsedEnvelope {
	resource: { attributes: unknown };
	schemaUrl: unknown;
	scope: { name: string; version: string };
	records: unknown[];
}

/** Decode and unwrap one OTLP/JSON envelope file from an unzipped bundle. */
export function parseEnvelope(
	files: Record<string, Uint8Array>,
	signal: Signal,
): ParsedEnvelope {
	const env = ENVELOPES[signal];
	type Rec = Record<string, unknown>;
	const json = JSON.parse(new TextDecoder().decode(files[env.file])) as Rec;
	const wrapper = (json[env.resourceKey] as Rec[])[0];
	const scopeWrapper = (wrapper[env.scopeKey] as Rec[])[0];
	return {
		resource: wrapper.resource as { attributes: unknown },
		schemaUrl: wrapper.schemaUrl,
		scope: scopeWrapper.scope as { name: string; version: string },
		records: scopeWrapper[env.recordsKey] as unknown[],
	};
}
