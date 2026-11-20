import type { MemoryState, MemoryStatus } from "../memory/pressure";
import type { TelemetryReporter } from "../telemetry/reporter";

/** Telemetry for workspace memory monitoring. */
export class MemoryTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	/** Emits `memory.state_transitioned` when the memory state changes. */
	public stateTransitioned(from: MemoryState, status: MemoryStatus): void {
		const properties: Record<string, string> = { from, to: status.state };
		const measurements: Record<string, number> = {};
		if (status.state !== "unavailable") {
			properties.source = status.sample.source;
			measurements.usage_percent = status.percent;
			if (status.trigger) {
				properties.trigger = status.trigger;
			}
			if (status.sample.pressure !== undefined) {
				measurements.pressure_percent = status.sample.pressure;
			}
		}
		this.telemetry.log("memory.state_transitioned", properties, measurements);
	}
}
