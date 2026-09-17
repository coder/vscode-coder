import * as vscode from "vscode";

import { watchConfigurationChanges } from "../configWatcher";
import { type Logger } from "../logging/logger";
import {
	TELEMETRY_LEVEL_SETTING,
	readTelemetryLevel,
} from "../settings/telemetry";

import {
	buildErrorBlock,
	type CallerMeasurements,
	type CallerProperties,
	type CallerPropertyValue,
	type SessionContext,
	type TelemetryContext,
	type TelemetryEvent,
	type TelemetryLevel,
	type TelemetrySink,
} from "./event";
import { newSpanId, newTraceId } from "./ids";
import { NOOP_SPAN, type Span, type SpanResult } from "./span";
import { CURRENT_TELEMETRY_SCHEMA_VERSION } from "./wireFormat";

import type { TelemetryReporter } from "./reporter";

const LEVEL_ORDER: Readonly<Record<TelemetryLevel, number>> = {
	off: 0,
	local: 1,
};

const readLevel = (): TelemetryLevel =>
	readTelemetryLevel(vscode.workspace.getConfiguration());

const stringifyProps = (
	props: Record<string, CallerPropertyValue>,
): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(props)) {
		out[k] = typeof v === "string" ? v : String(v);
	}
	return out;
};

/** Trace context shared by all events in one trace. */
interface SpanOptions {
	traceId: string;
	parentEventId?: string;
	/** Level frozen at trace start so a mid-trace toggle does not orphan events. */
	traceLevel: TelemetryLevel;
}

interface EmitOptions extends Partial<SpanOptions> {
	error?: unknown;
}

/** Per-sink flush outcome. */
export interface SinkFlushResult {
	readonly name: string;
	readonly ok: boolean;
}

/** Structured result of flushing all sinks; `ok` is true only if all flushed. */
export interface FlushStatus {
	readonly ok: boolean;
	readonly sinks: readonly SinkFlushResult[];
}

/**
 * Emits structured telemetry events to a fan-out of sinks. Sinks are filtered
 * by `minLevel` and may self-gate. `dispose` flushes are best-effort since
 * VS Code does not await deactivation.
 */
export class TelemetryService implements vscode.Disposable, TelemetryReporter {
	#level: TelemetryLevel;
	#nextSequence = 0;
	#deploymentUrl = "";
	readonly #session: SessionContext;
	readonly #configWatcher: vscode.Disposable;

	public constructor(
		session: SessionContext,
		private readonly sinks: readonly TelemetrySink[],
		private readonly logger: Logger,
	) {
		this.#session = session;
		this.#level = readLevel();
		this.#configWatcher = watchConfigurationChanges(
			[{ setting: TELEMETRY_LEVEL_SETTING, getValue: readLevel }],
			(changes) => {
				const next = changes.get(TELEMETRY_LEVEL_SETTING) as
					| TelemetryLevel
					| undefined;
				if (!next) {
					return;
				}
				this.#applyLevelChange(next).catch((err) => {
					this.logger.warn("Telemetry level change failed", err);
				});
			},
		);
	}

	public setDeploymentUrl(url: string): void {
		this.#deploymentUrl = url;
	}

	/** Snapshot of the context every emitted event currently carries. */
	public getContext(): TelemetryContext {
		return { ...this.#session, deploymentUrl: this.#deploymentUrl };
	}

	public log(
		eventName: string,
		properties: CallerProperties = {},
		measurements: CallerMeasurements = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#safeEmit(
			newSpanId(),
			eventName,
			stringifyProps(properties),
			measurements,
		);
	}

	public logError(
		eventName: string,
		error: unknown,
		properties: CallerProperties = {},
		measurements: CallerMeasurements = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#safeEmit(
			newSpanId(),
			eventName,
			stringifyProps(properties),
			measurements,
			{ error },
		);
	}

	/**
	 * Run a timed operation. The emitted event carries `durationMs` and a
	 * `result` of `success`, `error`, or `aborted` (set via `span.markAborted()`
	 * for intentional early exits). All events from one call share a `traceId`;
	 * child phases and span logs carry `parentEventId`.
	 */
	public trace<T>(
		eventName: string,
		fn: (span: Span) => Promise<T>,
		properties: CallerProperties = {},
		measurements: CallerMeasurements = {},
	): Promise<T> {
		if (this.#level === "off") {
			return fn(NOOP_SPAN);
		}
		return this.#startSpan(
			eventName,
			fn,
			stringifyProps(properties),
			measurements,
			{
				traceId: newTraceId(),
				traceLevel: this.#level,
			},
		);
	}

	public async flush(): Promise<FlushStatus> {
		const sinks = await Promise.all(
			this.sinks.map(async (sink) => ({
				name: sink.name,
				ok: await this.#flushSink(sink),
			})),
		);
		return { ok: sinks.every((s) => s.ok), sinks };
	}

	public async dispose(): Promise<void> {
		this.#configWatcher.dispose();
		await this.flush();
		await Promise.allSettled(this.sinks.map((sink) => this.#disposeSink(sink)));
	}

	#flushSink(sink: TelemetrySink): Promise<boolean> {
		// The sink logs its own flush failure with detail; we only need the
		// outcome for FlushStatus.
		return sink.flush().then(
			() => true,
			() => false,
		);
	}

	#startSpan<T>(
		eventName: string,
		fn: (span: Span) => Promise<T>,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		spanOpts: SpanOptions,
	): Promise<T> {
		const eventId = newSpanId();
		const spanProperties = { ...properties };
		const spanMeasurements = { ...measurements };
		const { traceId, traceLevel } = spanOpts;
		let completed = false;
		// `markError` wins over `markAborted` regardless of call order.
		let mark: "aborted" | "error" | undefined;
		const warnPostEmit = (op: string, name: string): void => {
			this.logger.warn(
				`Telemetry span '${eventName}' ${op}('${name}') called after emit; call ignored`,
			);
		};
		const emitSpanLog = (
			logName: string,
			logProperties: CallerProperties,
			logMeasurements: CallerMeasurements,
			error?: unknown,
		): void => {
			const safeName = this.#sanitizeChildName(logName, "log");
			this.#safeEmit(
				newSpanId(),
				`${eventName}.${safeName}`,
				stringifyProps(logProperties),
				logMeasurements,
				{ traceId, parentEventId: eventId, traceLevel, error },
			);
		};
		const span: Span = {
			traceId,
			eventId,
			eventName,
			phase: <U>(
				phaseName: string,
				phaseFn: (childSpan: Span) => Promise<U>,
				phaseProps: CallerProperties = {},
				phaseMeasurements: CallerMeasurements = {},
			): Promise<U> => {
				if (completed) {
					warnPostEmit("phase", phaseName);
					return phaseFn(NOOP_SPAN);
				}
				const safeName = this.#sanitizeChildName(phaseName, "phase");
				return this.#startSpan(
					`${eventName}.${safeName}`,
					phaseFn,
					stringifyProps(phaseProps),
					phaseMeasurements,
					{ traceId, parentEventId: eventId, traceLevel },
				);
			},
			log: (
				logName: string,
				logProperties: CallerProperties = {},
				logMeasurements: CallerMeasurements = {},
			): void => {
				if (completed) {
					warnPostEmit("log", logName);
					return;
				}
				emitSpanLog(logName, logProperties, logMeasurements);
			},
			logError: (
				logName: string,
				error: unknown,
				logProperties: CallerProperties = {},
				logMeasurements: CallerMeasurements = {},
			): void => {
				if (completed) {
					warnPostEmit("logError", logName);
					return;
				}
				emitSpanLog(logName, logProperties, logMeasurements, error);
			},
			setProperty(name: string, value: CallerPropertyValue): void {
				if (completed) {
					warnPostEmit("setProperty", name);
					return;
				}
				spanProperties[name] =
					typeof value === "string" ? value : String(value);
			},
			setMeasurement(name: string, value: number): void {
				if (completed) {
					warnPostEmit("setMeasurement", name);
					return;
				}
				spanMeasurements[name] = value;
			},
			markAborted(): void {
				if (completed) {
					warnPostEmit("markAborted", "");
					return;
				}
				mark ??= "aborted";
			},
			markError(): void {
				if (completed) {
					warnPostEmit("markError", "");
					return;
				}
				mark = "error";
			},
		};
		return this.#emitTimed(
			eventId,
			eventName,
			() => fn(span),
			spanProperties,
			spanMeasurements,
			spanOpts,
			() => mark ?? "success",
		).finally(() => {
			completed = true;
		});
	}

	#sanitizeChildName(name: string, kind: "phase" | "log"): string {
		if (!name.includes(".")) {
			return name;
		}
		const sanitized = name.replaceAll(".", "_");
		this.logger.warn(
			`Telemetry ${kind} name '${name}' contains '.', sanitized to '${sanitized}'`,
		);
		return sanitized;
	}

	async #emitTimed<T>(
		eventId: string,
		eventName: string,
		fn: () => Promise<T>,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		spanOpts: SpanOptions,
		resolveResult: () => SpanResult,
	): Promise<T> {
		const start = performance.now();
		const send = (result: SpanResult, error?: unknown): void =>
			this.#safeEmit(
				eventId,
				eventName,
				{ ...properties, result },
				{ ...measurements, durationMs: performance.now() - start },
				{ ...spanOpts, error },
			);
		try {
			const value = await fn();
			send(resolveResult());
			return value;
		} catch (err) {
			send("error", err);
			throw err;
		}
	}

	/** Catch-all wrapper around `#emit`: telemetry failures never reach callers. */
	#safeEmit(
		eventId: string,
		eventName: string,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		options: EmitOptions = {},
	): void {
		try {
			this.#emit(eventId, eventName, properties, measurements, options);
		} catch (err) {
			this.logger.warn("Telemetry emit failed", err);
		}
	}

	#emit(
		eventId: string,
		eventName: string,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		options: EmitOptions = {},
	): void {
		const { traceId, parentEventId, error, traceLevel } = options;
		const event: TelemetryEvent = {
			eventId,
			eventName,
			timestamp: new Date().toISOString(),
			eventSequence: this.#nextSequence++,
			schemaVersion: CURRENT_TELEMETRY_SCHEMA_VERSION,
			context: this.getContext(),
			properties: { ...properties },
			measurements: { ...measurements },
			...(traceId !== undefined && { traceId }),
			...(parentEventId !== undefined && { parentEventId }),
			...(error !== undefined && { error: buildErrorBlock(error) }),
		};

		const currentOrder = LEVEL_ORDER[traceLevel ?? this.#level];
		for (const sink of this.sinks) {
			if (currentOrder < LEVEL_ORDER[sink.minLevel]) {
				continue;
			}
			try {
				sink.write(event);
			} catch (err) {
				this.logger.warn(`Telemetry sink '${sink.name}' write failed`, err);
			}
		}

		this.logger.trace(`[telemetry] ${eventName}`, event);
	}

	async #applyLevelChange(newLevel: TelemetryLevel): Promise<void> {
		if (newLevel === this.#level) {
			return;
		}
		this.#level = newLevel;
		if (newLevel === "off") {
			await this.flush();
		}
	}

	async #disposeSink(sink: TelemetrySink): Promise<void> {
		try {
			await sink.dispose();
		} catch (err) {
			this.logger.warn(`Telemetry sink '${sink.name}' dispose failed`, err);
		}
	}
}
