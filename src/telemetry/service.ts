import * as vscode from "vscode";

import { watchConfigurationChanges } from "../configWatcher";
import { type Logger } from "../logging/logger";

import { emitTimed, type EmitFn } from "./emit";
import {
	buildSession,
	buildErrorBlock,
	type SessionContext,
	type TelemetryEvent,
	type TelemetrySink,
} from "./event";
import { Trace } from "./trace";

type TelemetryLevel = "off" | "local";

const TELEMETRY_LEVEL_SETTING = "coder.telemetry.level";

const NOOP_TRACE = new Trace("", "", () => {
	// Off-mode tracer; no events are emitted.
});

/**
 * Emits structured telemetry events to a fan-out of sinks. Sinks self-gate;
 * `dispose` flushes are best-effort during deactivation since VS Code does
 * not await it.
 */
export class TelemetryService implements vscode.Disposable {
	#level: TelemetryLevel;
	#nextSequence = 0;
	#deploymentUrl = "";
	readonly #session: SessionContext;
	readonly #configWatcher: vscode.Disposable;
	readonly #emitter: EmitFn = (n, p, m, t, e) => this.#emit(n, p, m, t, e);

	constructor(
		ctx: vscode.ExtensionContext,
		private readonly sinks: readonly TelemetrySink[],
		private readonly logger: Logger,
	) {
		this.#session = buildSession(ctx);
		this.#level = readLevel();
		this.#configWatcher = watchConfigurationChanges(
			[{ setting: TELEMETRY_LEVEL_SETTING, getValue: readLevel }],
			(changes) => {
				const newLevel = changes.get(TELEMETRY_LEVEL_SETTING) as TelemetryLevel;
				this.#applyLevelChange(newLevel).catch((err) => {
					this.logger.warn("Telemetry level change failed", err);
				});
			},
		);
	}

	setDeploymentUrl(url: string): void {
		this.#deploymentUrl = url;
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
				await this.#safeCall(sink, "flush");
				await this.#safeCall(sink, "dispose");
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
			context: { ...this.#session, deploymentUrl: this.#deploymentUrl },
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
