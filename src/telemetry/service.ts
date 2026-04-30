import * as vscode from "vscode";

import { watchConfigurationChanges } from "../configWatcher";
import { type Logger } from "../logging/logger";

import {
	buildSession,
	buildErrorBlock,
	type SessionContext,
	type TelemetryEvent,
	type TelemetryLevel,
	type TelemetrySink,
} from "./event";
import { NOOP_SPAN, type Span } from "./span";

const TELEMETRY_LEVEL_SETTING = "coder.telemetry.level";

const LEVEL_ORDER: Readonly<Record<TelemetryLevel, number>> = {
	off: 0,
	local: 1,
};

interface EmitOptions {
	traceId?: string;
	parentEventId?: string;
	error?: unknown;
}

/**
 * Emits structured telemetry events to a fan-out of sinks. Sinks are filtered
 * by `minLevel` and may self-gate. `dispose` flushes are best-effort since
 * VS Code does not await deactivation.
 */
export class TelemetryService implements vscode.Disposable {
	#level: TelemetryLevel;
	#nextSequence = 0;
	#deploymentUrl = "";
	readonly #session: SessionContext;
	readonly #configWatcher: vscode.Disposable;

	public constructor(
		ctx: vscode.ExtensionContext,
		private readonly sinks: readonly TelemetrySink[],
		private readonly logger: Logger,
	) {
		this.#session = buildSession(ctx);
		this.#level = readLevel();
		this.#configWatcher = watchConfigurationChanges(
			[{ setting: TELEMETRY_LEVEL_SETTING, getValue: readLevel }],
			(changes) => {
				const raw = changes.get(TELEMETRY_LEVEL_SETTING);
				if (!isTelemetryLevel(raw)) {
					return;
				}
				this.#applyLevelChange(raw).catch((err) => {
					this.logger.warn("Telemetry level change failed", err);
				});
			},
		);
	}

	public setDeploymentUrl(url: string): void {
		this.#deploymentUrl = url;
	}

	public log(
		eventName: string,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#safeEmit(crypto.randomUUID(), eventName, properties, measurements);
	}

	public logError(
		eventName: string,
		error: unknown,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#safeEmit(crypto.randomUUID(), eventName, properties, measurements, {
			error,
		});
	}

	/** Time `fn` and emit one event with `durationMs` and `result`. */
	public time<T>(
		eventName: string,
		fn: () => Promise<T>,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): Promise<T> {
		return this.trace(eventName, fn, properties, measurements);
	}

	/**
	 * Run a multi-phase operation. All events share a `traceId`; each non-root
	 * carries `parentEventId`. Framework sets `result` and `durationMs`.
	 */
	public trace<T>(
		eventName: string,
		fn: (span: Span) => Promise<T>,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): Promise<T> {
		if (this.#level === "off") {
			return fn(NOOP_SPAN);
		}
		return this.#startSpan(
			crypto.randomUUID(),
			eventName,
			fn,
			properties,
			measurements,
		);
	}

	public async dispose(): Promise<void> {
		this.#configWatcher.dispose();
		await Promise.allSettled(
			this.sinks.map(async (sink) => {
				await this.#safeCall(sink, "flush");
				await this.#safeCall(sink, "dispose");
			}),
		);
	}

	#startSpan<T>(
		traceId: string,
		eventName: string,
		fn: (span: Span) => Promise<T>,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		parentEventId?: string,
	): Promise<T> {
		const eventId = crypto.randomUUID();
		const span: Span = {
			traceId,
			eventId,
			eventName,
			phase: <U>(
				phaseName: string,
				phaseFn: (childSpan: Span) => Promise<U>,
				phaseProps: Record<string, string> = {},
				phaseMeasurements: Record<string, number> = {},
			): Promise<U> => {
				const safeName = this.#sanitizePhaseName(phaseName);
				return this.#startSpan(
					traceId,
					`${eventName}.${safeName}`,
					phaseFn,
					phaseProps,
					phaseMeasurements,
					eventId,
				);
			},
		};
		return this.#emitTimed(
			eventId,
			eventName,
			() => fn(span),
			properties,
			measurements,
			{ traceId, parentEventId },
		);
	}

	#sanitizePhaseName(name: string): string {
		if (!name.includes(".")) {
			return name;
		}
		const sanitized = name.replaceAll(".", "_");
		this.logger.warn(
			`Telemetry phase name '${name}' contains '.', sanitized to '${sanitized}'`,
		);
		return sanitized;
	}

	async #emitTimed<T>(
		eventId: string,
		eventName: string,
		fn: () => Promise<T>,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		options: Omit<EmitOptions, "error"> = {},
	): Promise<T> {
		const start = performance.now();
		const send = (result: "success" | "error", error?: unknown): void =>
			this.#safeEmit(
				eventId,
				eventName,
				{ ...properties, result },
				{ ...measurements, durationMs: performance.now() - start },
				{ ...options, error },
			);
		try {
			const value = await fn();
			send("success");
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
		const { traceId, parentEventId, error } = options;
		const event: TelemetryEvent = {
			eventId,
			eventName,
			timestamp: new Date().toISOString(),
			eventSequence: this.#nextSequence++,
			context: { ...this.#session, deploymentUrl: this.#deploymentUrl },
			properties: { ...properties },
			measurements: { ...measurements },
			...(traceId !== undefined && { traceId }),
			...(parentEventId !== undefined && { parentEventId }),
			...(error !== undefined && { error: buildErrorBlock(error) }),
		};

		const currentOrder = LEVEL_ORDER[this.#level];
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
			await Promise.allSettled(
				this.sinks.map((sink) => this.#safeCall(sink, "flush")),
			);
		}
	}

	async #safeCall(
		sink: TelemetrySink,
		action: "flush" | "dispose",
	): Promise<void> {
		try {
			await sink[action]();
		} catch (err) {
			this.logger.warn(`Telemetry sink '${sink.name}' ${action} failed`, err);
		}
	}
}

function readLevel(): TelemetryLevel {
	switch (
		vscode.workspace.getConfiguration().get<string>(TELEMETRY_LEVEL_SETTING)
	) {
		case "off":
			return "off";
		default:
			return "local";
	}
}

function isTelemetryLevel(value: unknown): value is TelemetryLevel {
	return value === "off" || value === "local";
}
