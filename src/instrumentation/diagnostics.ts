import { recordAborted, recordError } from "./outcomes";

import type { SpeedtestResult } from "@repo/shared";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

import type { WorkspacePickerErrorCategory } from "./workspaceOpen";

export type DiagnosticCommand =
	| "speed_test"
	| "support_bundle"
	| "export_telemetry";
export type DiagnosticErrorCategory =
	| WorkspacePickerErrorCategory
	| "parse_error"
	| "unsupported_cli"
	| "error";
export type DiagnosticAbortStage =
	| "workspace_picker"
	| "input"
	| "prompt"
	| "save_dialog"
	| "progress";

export interface DiagnosticTrace {
	abort(stage: DiagnosticAbortStage): void;
	fail(category?: DiagnosticErrorCategory): void;
	setRequestedDuration(seconds: number): void;
	succeedSpeedtest(result: SpeedtestResult): void;
	succeedExport(format: string, eventCount: number): void;
}

/** Emits `command.diagnostic.completed` around each diagnostic command. */
export class DiagnosticTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public trace(
		command: DiagnosticCommand,
		fn: (trace: DiagnosticTrace) => Promise<void>,
	): Promise<void> {
		return this.telemetry.trace(
			"command.diagnostic.completed",
			(span) => fn(new SpanDiagnosticTrace(span)),
			{ command },
		);
	}
}

class SpanDiagnosticTrace implements DiagnosticTrace {
	public constructor(private readonly span: Span) {}

	public abort(stage: DiagnosticAbortStage): void {
		recordAborted(this.span, stage);
	}

	public fail(category: DiagnosticErrorCategory = "error"): void {
		recordError(this.span, category);
	}

	public setRequestedDuration(seconds: number): void {
		this.span.setMeasurement("requested_duration_seconds", seconds);
	}

	public succeedSpeedtest(result: SpeedtestResult): void {
		this.span.setMeasurement("interval_count", result.intervals.length);
		this.span.setMeasurement(
			"throughput_mbits",
			result.overall.throughput_mbits,
		);
	}

	public succeedExport(format: string, eventCount: number): void {
		this.span.setProperty("format", format);
		this.span.setMeasurement("event_count", eventCount);
	}
}
