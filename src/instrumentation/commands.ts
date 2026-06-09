import { extractAgents } from "../api/api-helper";
import { isAbortError } from "../error/errorUtils";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { SpeedtestResult } from "@repo/shared";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type WorkspaceOpenSource =
	| "command"
	| "sidebar_agent"
	| "sidebar_workspace"
	| "sidebar_fallback"
	| "uri";

export type WorkspacePickerSource = "workspace_open" | "diagnostic";
export type WorkspacePickerFailureCategory = "fetch_failed";
type AbortableFailureCategory = "aborted" | "error";
export type WorkspaceOpenFailureCategory =
	| WorkspacePickerFailureCategory
	| AbortableFailureCategory;
export type WorkspacePickerResult =
	| { readonly status: "selected"; readonly workspace: Workspace }
	| { readonly status: "cancelled" }
	| {
			readonly status: "failed";
			readonly category: WorkspacePickerFailureCategory;
	  };
export type DiagnosticCommand =
	| "speed_test"
	| "support_bundle"
	| "export_telemetry";
export type DiagnosticFailureCategory =
	| WorkspacePickerFailureCategory
	| "parse_error"
	| "unsupported_cli"
	| "error";
export type DevcontainerMode = "dev_container" | "attached_container";
export type DevcontainerFailureCategory = AbortableFailureCategory;
export type WorkspaceOpenCancelStage =
	| "workspace_picker"
	| "agent_picker"
	| "recent_folder_picker";
export type DiagnosticCancelStage =
	| "workspace_picker"
	| "input"
	| "prompt"
	| "save_dialog"
	| "progress";

export interface WorkspaceOpenSelection {
	readonly workspace: Workspace;
	readonly agent?: WorkspaceAgent;
}

export interface WorkspacePickerTrace {
	finish(result: WorkspacePickerResult, resultCount: number): void;
}

export interface WorkspaceOpenTrace {
	select(selection: WorkspaceOpenSelection): void;
	cancel(
		stage: WorkspaceOpenCancelStage,
		selection?: WorkspaceOpenSelection,
	): void;
	fail(category: WorkspaceOpenFailureCategory): void;
	handoff(kind: "folder" | "empty_window"): void;
}

export interface DiagnosticTrace {
	cancel(stage: DiagnosticCancelStage): void;
	fail(category?: DiagnosticFailureCategory): void;
	speedtestRequestedDuration(seconds: number): void;
	speedtestSuccess(result: SpeedtestResult): void;
	exportSuccess(format: string, eventCount: number): void;
}

export class CommandTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public diagnostic(
		command: DiagnosticCommand,
		fn: (trace: DiagnosticTrace) => Promise<void>,
	): Promise<void> {
		return this.telemetry.trace(
			"command.diagnostic.completed",
			(span) => fn(new SpanDiagnosticTrace(span)),
			{ command },
		);
	}

	public async workspaceOpen(
		source: WorkspaceOpenSource,
		selection: WorkspaceOpenSelection | undefined,
		fn: (trace: WorkspaceOpenTrace) => Promise<boolean>,
	): Promise<boolean> {
		let deferredError: unknown;
		let failed = false;
		const opened = await this.telemetry.trace(
			"workspace.open",
			async (span) => {
				const trace = new SpanWorkspaceOpenTrace(span);
				if (selection) {
					trace.select(selection);
				}
				try {
					const result = await fn(trace);
					if (!result) {
						span.markAborted();
					}
					return result;
				} catch (error) {
					failed = true;
					deferredError = error;
					trace.fail(categorizeAbortableFailure(error));
					return false;
				}
			},
			{ source },
		);
		if (failed) {
			throw deferredError;
		}
		return opened;
	}

	public workspacePicker(
		source: WorkspacePickerSource,
		fn: (trace: WorkspacePickerTrace) => Promise<WorkspacePickerResult>,
	): Promise<WorkspacePickerResult> {
		return this.telemetry.trace(
			"workspace.picker.prompted",
			(span) => fn(new SpanWorkspacePickerTrace(span)),
			{ source },
		);
	}

	public async devcontainerOpen(
		mode: DevcontainerMode,
		fn: () => Promise<void>,
	): Promise<void> {
		let deferredError: unknown;
		let failed = false;
		await this.telemetry.trace(
			"workspace.dev_container.open",
			async (span) => {
				try {
					await fn();
				} catch (error) {
					failed = true;
					deferredError = error;
					recordFailure(span, categorizeAbortableFailure(error));
				}
			},
			{ mode },
		);
		if (failed) {
			throw deferredError;
		}
	}
}

class SpanWorkspacePickerTrace implements WorkspacePickerTrace {
	public constructor(private readonly span: Span) {}

	public finish(result: WorkspacePickerResult, resultCount: number): void {
		recordWorkspacePickerResult(this.span, result, resultCount);
	}
}

class SpanWorkspaceOpenTrace implements WorkspaceOpenTrace {
	public constructor(private readonly span: Span) {}

	public select(selection: WorkspaceOpenSelection): void {
		recordWorkspaceContext(this.span, selection.workspace, selection.agent);
	}

	public cancel(
		stage: WorkspaceOpenCancelStage,
		selection?: WorkspaceOpenSelection,
	): void {
		recordWorkspaceOpenCancelled(this.span, stage, selection);
	}

	public fail(category: WorkspaceOpenFailureCategory): void {
		recordFailure(this.span, category);
	}

	public handoff(kind: "folder" | "empty_window"): void {
		this.span.setProperty("handoff", kind);
	}
}

class SpanDiagnosticTrace implements DiagnosticTrace {
	public constructor(private readonly span: Span) {}

	public cancel(stage: DiagnosticCancelStage): void {
		recordCancelled(this.span, stage);
	}

	public fail(category: DiagnosticFailureCategory = "error"): void {
		recordFailure(this.span, category);
	}

	public speedtestRequestedDuration(seconds: number): void {
		this.span.setMeasurement("requested_duration_seconds", seconds);
	}

	public speedtestSuccess(result: SpeedtestResult): void {
		recordSpeedtestResult(this.span, result);
	}

	public exportSuccess(format: string, eventCount: number): void {
		this.span.setProperty("format", format);
		this.span.setMeasurement("event_count", eventCount);
	}
}

function recordWorkspaceContext(
	span: Span,
	workspace: Workspace,
	agent?: WorkspaceAgent,
): void {
	const agents = extractAgents(workspace.latest_build.resources);
	span.setProperty("workspace_status", workspace.latest_build.status);
	span.setProperty("workspace_outdated", workspace.outdated);
	span.setMeasurement("agent_count", agents.length);
	span.setMeasurement(
		"connected_agent_count",
		agents.filter((candidate) => candidate.status === "connected").length,
	);
	if (!agent) {
		return;
	}
	span.setProperty("agent_status", agent.status);
	span.setProperty("agent_lifecycle_state", agent.lifecycle_state);
}

function recordWorkspacePickerResult(
	span: Span,
	result: WorkspacePickerResult,
	resultCount: number,
): void {
	span.setMeasurement("workspace_count", resultCount);
	if (result.status === "selected") {
		recordWorkspaceContext(span, result.workspace);
		return;
	}
	if (result.status === "failed") {
		recordFailure(span, result.category);
		return;
	}
	span.markAborted();
}

function recordWorkspaceOpenCancelled(
	span: Span,
	stage: WorkspaceOpenCancelStage,
	selection?: WorkspaceOpenSelection,
): void {
	span.setProperty("cancel_stage", stage);
	if (selection) {
		recordWorkspaceContext(span, selection.workspace, selection.agent);
	}
	span.markAborted();
}

function recordCancelled(span: Span, stage: DiagnosticCancelStage): void {
	span.setProperty("cancel_stage", stage);
	span.markAborted();
}

function recordFailure(
	span: Span,
	category:
		| DiagnosticFailureCategory
		| WorkspaceOpenFailureCategory
		| DevcontainerFailureCategory,
): void {
	span.setProperty("failure_category", category);
	span.markFailure();
}

function recordSpeedtestResult(span: Span, result: SpeedtestResult): void {
	span.setMeasurement("interval_count", result.intervals.length);
	span.setMeasurement("throughput_mbits", result.overall.throughput_mbits);
}

function categorizeAbortableFailure(error: unknown): AbortableFailureCategory {
	if (isAbortError(error)) {
		return "aborted";
	}
	return "error";
}
