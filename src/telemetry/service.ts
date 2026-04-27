import * as vscode from "vscode";

import { watchConfigurationChanges } from "../configWatcher";
import { type Logger } from "../logging/logger";

import {
	buildContext,
	buildErrorBlock,
	type TelemetryContext,
	type TelemetryEvent,
	type TelemetrySink,
} from "./event";
import { emitTimed, Trace, type EmitFn } from "./trace";

const noopEmit: EmitFn = () => {
	// Intentionally empty: used by NOOP_TRACE when telemetry is off.
};
const NOOP_TRACE = new Trace("", "", noopEmit);

type TelemetryLevel = "off" | "local";

const TELEMETRY_LEVEL_SETTING = "coder.telemetry.level";

/**
 * Emits structured telemetry events to a fan-out of sinks.
 *
 * Phase A ships with no real sinks; this service is the spine that future
 * sinks (`LocalJsonlSink`, `CoderServerSink`, external services) plug into.
 * Each sink owns its own gating beyond the service-level
 * `coder.telemetry.level` kill switch.
 *
 * `dispose()` returns `Promise<void>` for explicit awaits; VS Code does not
 * await deactivation, so flushes during shutdown are best-effort.
 */
export class TelemetryService implements vscode.Disposable {
	#level: TelemetryLevel;
	#nextSequence = 0;
	#context: TelemetryContext;
	readonly #configWatcher: vscode.Disposable;
	readonly #emitter: EmitFn = (n, p, m, t, e) => this.#emit(n, p, m, t, e);

	constructor(
		ctx: vscode.ExtensionContext,
		private readonly sinks: readonly TelemetrySink[],
		private readonly logger: Logger,
	) {
		this.#context = buildContext(ctx);
		this.#level = readTelemetryLevel();
		this.#configWatcher = watchConfigurationChanges(
			[
				{
					setting: TELEMETRY_LEVEL_SETTING,
					getValue: () =>
						vscode.workspace
							.getConfiguration()
							.get<string>(TELEMETRY_LEVEL_SETTING),
				},
			],
			(changes) => {
				this.#applyLevelChange(changes.get(TELEMETRY_LEVEL_SETTING)).catch(
					(err) => {
						this.logger.warn("Telemetry level change failed", err);
					},
				);
			},
		);
	}

	setDeploymentUrl(url: string): void {
		if (url === this.#context.deploymentUrl) {
			return;
		}
		this.#context = { ...this.#context, deploymentUrl: url };
	}

	log(
		eventName: string,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#emit(eventName, properties, measurements);
	}

	logError(
		eventName: string,
		error: unknown,
		properties: Record<string, string> = {},
		measurements: Record<string, number> = {},
	): void {
		if (this.#level === "off") {
			return;
		}
		this.#emit(eventName, properties, measurements, undefined, error);
	}

	time<T>(
		eventName: string,
		fn: () => Promise<T>,
		properties: Record<string, string> = {},
	): Promise<T> {
		if (this.#level === "off") {
			return fn();
		}
		return emitTimed(this.#emitter, eventName, fn, properties);
	}

	trace<T>(
		eventName: string,
		fn: (trace: Trace) => Promise<T>,
		properties: Record<string, string> = {},
	): Promise<T> {
		if (this.#level === "off") {
			return fn(NOOP_TRACE);
		}
		const traceId = crypto.randomUUID();
		const tracer = new Trace(eventName, traceId, this.#emitter);
		return emitTimed(
			this.#emitter,
			eventName,
			() => fn(tracer),
			properties,
			traceId,
		);
	}

	async dispose(): Promise<void> {
		this.#configWatcher.dispose();
		await Promise.allSettled(
			this.sinks.map(async (sink) => {
				try {
					await sink.flush();
				} catch (err) {
					this.logger.warn(
						`Telemetry sink '${sink.name}' flush failed during dispose`,
						err,
					);
				}
				try {
					await sink.dispose();
				} catch (err) {
					this.logger.warn(`Telemetry sink '${sink.name}' dispose failed`, err);
				}
			}),
		);
	}

	#emit(
		eventName: string,
		properties: Record<string, string>,
		measurements: Record<string, number>,
		traceId?: string,
		error?: unknown,
	): void {
		if (this.#level === "off") {
			return;
		}

		const event: TelemetryEvent = {
			eventId: crypto.randomUUID(),
			eventName,
			timestamp: new Date().toISOString(),
			eventSequence: this.#nextSequence++,
			context: { ...this.#context },
			properties,
			measurements,
		};
		if (traceId !== undefined) {
			event.traceId = traceId;
		}
		if (error !== undefined) {
			event.error = buildErrorBlock(error);
		}

		for (const sink of this.sinks) {
			try {
				sink.write(event);
			} catch (err) {
				this.logger.warn(`Telemetry sink '${sink.name}' write failed`, err);
			}
		}

		this.logger.trace(`[telemetry] ${eventName}`, event);
	}

	async #applyLevelChange(rawValue: unknown): Promise<void> {
		const newLevel = coerceLevel(rawValue);
		if (newLevel === this.#level) {
			return;
		}
		this.#level = newLevel;
		if (newLevel === "off") {
			await Promise.allSettled(
				this.sinks.map((sink) =>
					sink.flush().catch((err) => {
						this.logger.warn(`Telemetry sink '${sink.name}' flush failed`, err);
					}),
				),
			);
		}
	}
}

function readTelemetryLevel(): TelemetryLevel {
	return coerceLevel(
		vscode.workspace
			.getConfiguration()
			.get<string>(TELEMETRY_LEVEL_SETTING, "local"),
	);
}

function coerceLevel(value: unknown): TelemetryLevel {
	return value === "off" ? "off" : "local";
}
