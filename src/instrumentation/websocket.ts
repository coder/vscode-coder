import type { CallerProperties } from "../telemetry/event";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { ConnectionState } from "../websocket/reconnectingWebSocket";

export type ConnectionStateReason =
	| "initial_connect"
	| "manual_reconnect"
	| "certificate_refresh"
	| "scheduled_reconnect"
	| "open"
	| "disconnect"
	| "dispose"
	| "unrecoverable_close"
	| "unrecoverable_http"
	| "certificate_error"
	| "connection_error"
	| "normal_close"
	| "unexpected_close";

export type ConnectionDropCause =
	| "manual_disconnect"
	| "replaced"
	| "unrecoverable_close"
	| "normal_close"
	| "unexpected_close"
	| "disposed"
	| "error";

type ReconnectOutcome =
	| { readonly result: "success" }
	| {
			readonly result: "error";
			readonly terminationReason: ConnectionStateReason;
	  };

interface ReconnectCycle {
	readonly startMs: number;
	readonly reason: ConnectionStateReason;
	attempts: number;
}

interface DropOptions {
	cause: ConnectionDropCause;
	code?: number;
	error?: unknown;
}

export class WebSocketTelemetry {
	readonly #telemetry: TelemetryReporter;
	#connectStartedAtMs: number | undefined;
	#connectionOpenedAtMs: number | undefined;
	#reconnectCycle: ReconnectCycle | undefined;

	public constructor(telemetry: TelemetryReporter) {
		this.#telemetry = telemetry;
	}

	public stateTransition(
		from: ConnectionState,
		to: ConnectionState,
		reason: ConnectionStateReason,
	): void {
		this.#telemetry.log("connection.state_transitioned", {
			from,
			to,
			reason,
		});
	}

	/** Stamp the connect-start time; counts an attempt if a cycle is open. */
	public connectStarted(): void {
		this.#connectStartedAtMs = performance.now();
		if (this.#reconnectCycle) {
			this.#reconnectCycle.attempts += 1;
		}
	}

	public opened(route: string): void {
		const now = performance.now();
		const start = this.#connectStartedAtMs ?? now;
		this.#connectionOpenedAtMs = now;
		this.#connectStartedAtMs = undefined;
		this.#telemetry.log(
			"connection.opened",
			{ route },
			{ connectDurationMs: now - start },
		);
		this.#finishReconnect({ result: "success" });
	}

	public dropped(
		cause: ConnectionDropCause,
		closeCode?: number,
		error?: unknown,
	): void {
		// Capture-and-clear up-front so a throw, future await, or re-entry can't re-emit.
		const openedAtMs = this.#connectionOpenedAtMs;
		if (openedAtMs === undefined) {
			return;
		}
		this.#connectionOpenedAtMs = undefined;

		const properties: CallerProperties = { cause };
		if (closeCode !== undefined) {
			properties.closeCode = closeCode;
		}
		const measurements = {
			connectionDurationMs: performance.now() - openedAtMs,
		};
		if (error === undefined) {
			this.#telemetry.log("connection.dropped", properties, measurements);
		} else {
			this.#telemetry.logError(
				"connection.dropped",
				error,
				properties,
				measurements,
			);
		}
	}

	public reset(): void {
		this.#connectStartedAtMs = undefined;
		this.#connectionOpenedAtMs = undefined;
		this.#reconnectCycle = undefined;
	}

	/** Open a reconnect cycle. No-op if one is already open. */
	public reconnectStarted(reason: ConnectionStateReason): void {
		if (this.#reconnectCycle) {
			return;
		}
		this.#reconnectCycle = {
			startMs: performance.now(),
			reason,
			attempts: 0,
		};
	}

	/** Drop and end the reconnect cycle as a failure. */
	public terminated(reason: ConnectionStateReason, options: DropOptions): void {
		this.dropped(options.cause, options.code, options.error);
		this.#finishReconnect({ result: "error", terminationReason: reason });
	}

	/** Drop and (re)open a reconnect cycle. */
	public retrying(reason: ConnectionStateReason, options: DropOptions): void {
		this.dropped(options.cause, options.code, options.error);
		this.reconnectStarted(reason);
	}

	#finishReconnect(outcome: ReconnectOutcome): void {
		const cycle = this.#reconnectCycle;
		if (!cycle) {
			return;
		}
		this.#reconnectCycle = undefined;

		const properties: Record<string, string> = {
			result: outcome.result,
			reason: cycle.reason,
		};
		if (outcome.result === "error") {
			properties.terminationReason = outcome.terminationReason;
		}
		this.#telemetry.log("connection.reconnect_resolved", properties, {
			attempts: cycle.attempts,
			totalDurationMs: performance.now() - cycle.startMs,
		});
	}
}
