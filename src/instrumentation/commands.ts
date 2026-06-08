import { extractAgents } from "../api/api-helper";
import { isAbortError } from "../error/errorUtils";
import { parseSpeedtestResult } from "../webviews/speedtest/types";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { SpeedtestResult } from "@repo/shared";

import type { ProgressResult } from "../progress";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type WorkspaceOpenSource =
	| "command"
	| "sidebar.agent"
	| "sidebar.workspace"
	| "sidebar.fallback"
	| "uri";

export type WorkspacePickerSource = "workspace.open" | "diagnostic";
export type WorkspacePickerFailureCategory = "fetch_failed";
export type WorkspaceOpenFailureCategory =
	| WorkspacePickerFailureCategory
	| "aborted"
	| "error";
export type WorkspacePickerResult =
	| { readonly status: "selected"; readonly workspace: Workspace }
	| { readonly status: "cancelled" }
	| {
			readonly status: "failed";
			readonly category: WorkspacePickerFailureCategory;
	  };
export type DiagnosticCommandId =
	| "coder.speedTest"
	| "coder.supportBundle"
	| "coder.exportTelemetry";
export type DiagnosticFailureCategory =
	| WorkspacePickerFailureCategory
	| "parse_error"
	| "unsupported_cli"
	| "aborted"
	| "error";
export type DevcontainerMode = "dev_container" | "attached_container";
export type DevcontainerFailureCategory = "aborted" | "error";
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

type WorkspaceStateBucket =
	| "running"
	| "stopped"
	| "failed"
	| "starting"
	| "stopping"
	| "pending"
	| "deleting"
	| "deleted"
	| "canceled"
	| "canceling"
	| "unknown";

type AgentStatusBucket =
	| "connected"
	| "connecting"
	| "disconnected"
	| "timeout"
	| "unknown";

type AgentLifecycleBucket =
	| "ready"
	| "starting"
	| "created"
	| "start_error"
	| "start_timeout"
	| "shutting_down"
	| "off"
	| "shutdown_error"
	| "shutdown_timeout"
	| "unknown";

export interface WorkspaceOpenSelection {
	readonly workspace: Workspace;
	readonly agent?: WorkspaceAgent;
}

export interface WorkspacePickerTrace {
	selected(workspace: Workspace, resultCount: number): void;
	cancelled(resultCount: number): void;
	failed(category: WorkspacePickerFailureCategory, resultCount: number): void;
}

export interface WorkspaceOpenTrace {
	select(selection: WorkspaceOpenSelection): void;
	cancel(
		stage: WorkspaceOpenCancelStage,
		selection?: WorkspaceOpenSelection,
	): false;
	fail(category: WorkspaceOpenFailureCategory): false;
	handoff(kind: "folder" | "empty_window"): void;
}

export interface DiagnosticTrace {
	cancel(stage: DiagnosticCancelStage): void;
	fail(error: unknown, category?: DiagnosticFailureCategory): void;
	progressResult<T>(
		result: ProgressResult<T>,
	): result is { ok: true; value: T };
	speedtestRequestedDuration(seconds: number): void;
	speedtestSuccess(rawJson: string): SpeedtestResult;
	exportSuccess(format: string, eventCount: number): void;
}

export interface DevcontainerTrace {
	fail(error: unknown): void;
}

export class CommandInstrumentation {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public diagnostic(
		commandId: DiagnosticCommandId,
		fn: (trace: DiagnosticTrace) => Promise<void>,
	): Promise<void> {
		return this.telemetry.trace(
			"command.diagnostic.completed",
			(span) => fn(new SpanDiagnosticTrace(span)),
			{ commandId },
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
					trace.fail(categorizeWorkspaceOpenFailure(error));
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
		fn: (trace: DevcontainerTrace) => Promise<void>,
	): Promise<void> {
		let deferredError: unknown;
		let failed = false;
		await this.telemetry.trace(
			"workspace.devcontainer.open",
			async (span) => {
				const trace = new SpanDevcontainerTrace(span);
				try {
					await fn(trace);
				} catch (error) {
					failed = true;
					deferredError = error;
					trace.fail(error);
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

	public selected(workspace: Workspace, resultCount: number): void {
		setWorkspacePickerResult(this.span, workspace, resultCount);
	}

	public cancelled(resultCount: number): void {
		setWorkspacePickerResult(this.span, undefined, resultCount);
	}

	public failed(
		category: WorkspacePickerFailureCategory,
		resultCount: number,
	): void {
		setWorkspacePickerFailure(this.span, category, resultCount);
	}
}

class SpanWorkspaceOpenTrace implements WorkspaceOpenTrace {
	public constructor(private readonly span: Span) {}

	public select(selection: WorkspaceOpenSelection): void {
		setWorkspaceOpenSelection(this.span, selection);
	}

	public cancel(
		stage: WorkspaceOpenCancelStage,
		selection?: WorkspaceOpenSelection,
	): false {
		return markWorkspaceOpenCancelled(this.span, stage, selection);
	}

	public fail(category: WorkspaceOpenFailureCategory): false {
		return markWorkspaceOpenFailure(this.span, category);
	}

	public handoff(kind: "folder" | "empty_window"): void {
		this.span.setProperty("handoff", kind);
	}
}

class SpanDiagnosticTrace implements DiagnosticTrace {
	public constructor(private readonly span: Span) {}

	public cancel(stage: DiagnosticCancelStage): void {
		markDiagnosticCancelled(this.span, stage);
	}

	public fail(
		error: unknown,
		category: DiagnosticFailureCategory = categorizeFailure(error),
	): void {
		markDiagnosticFailure(this.span, error, category);
	}

	public progressResult<T>(
		result: ProgressResult<T>,
	): result is { ok: true; value: T } {
		return setDiagnosticProgressResult(this.span, result);
	}

	public speedtestRequestedDuration(seconds: number): void {
		this.span.setMeasurement("requestedDurationSec", seconds);
	}

	public speedtestSuccess(rawJson: string): SpeedtestResult {
		return setSpeedtestSuccess(this.span, rawJson);
	}

	public exportSuccess(format: string, eventCount: number): void {
		this.span.setProperty("format", format);
		this.span.setMeasurement("eventCount", eventCount);
	}
}

class SpanDevcontainerTrace implements DevcontainerTrace {
	public constructor(private readonly span: Span) {}

	public fail(error: unknown): void {
		this.span.setProperty(
			"failure.category",
			categorizeDevcontainerFailure(error),
		);
		this.span.markFailure();
	}
}

function setWorkspaceProperties(
	span: Span,
	workspace: Workspace,
	agent?: WorkspaceAgent,
): void {
	const agents = extractAgents(workspace.latest_build.resources);
	span.setProperty("workspace.status", bucketWorkspaceStatus(workspace));
	span.setProperty("workspace.outdated", workspace.outdated);
	span.setMeasurement("agentCount", agents.length);
	span.setMeasurement(
		"connectedAgentCount",
		agents.filter((candidate) => candidate.status === "connected").length,
	);
	if (!agent) {
		return;
	}
	span.setProperty("agent.status", bucketAgentStatus(agent));
	span.setProperty("agent.lifecycle_state", bucketAgentLifecycle(agent));
}

function setWorkspacePickerResult(
	span: Span,
	workspace: Workspace | undefined,
	resultCount: number,
): void {
	span.setMeasurement("workspaceCount", resultCount);
	if (!workspace) {
		span.markAborted();
		return;
	}
	setWorkspaceProperties(span, workspace);
}

function setWorkspacePickerFailure(
	span: Span,
	category: WorkspacePickerFailureCategory,
	resultCount: number,
): void {
	span.setMeasurement("workspaceCount", resultCount);
	span.setProperty("failure.category", category);
	span.markFailure();
}

function setWorkspaceOpenSelection(
	span: Span,
	selection: WorkspaceOpenSelection,
): void {
	setWorkspaceProperties(span, selection.workspace, selection.agent);
}

function markWorkspaceOpenCancelled(
	span: Span,
	stage: WorkspaceOpenCancelStage,
	selection?: WorkspaceOpenSelection,
): false {
	span.setProperty("cancel.stage", stage);
	if (selection) {
		setWorkspaceOpenSelection(span, selection);
	}
	span.markAborted();
	return false;
}

function markWorkspaceOpenFailure(
	span: Span,
	category: WorkspaceOpenFailureCategory,
	selection?: WorkspaceOpenSelection,
): false {
	span.setProperty("failure.category", category);
	if (selection) {
		setWorkspaceOpenSelection(span, selection);
	}
	span.markFailure();
	return false;
}

function setDiagnosticProgressResult<T>(
	span: Span,
	result: ProgressResult<T>,
): result is { ok: true; value: T } {
	if (result.ok) {
		return true;
	}
	if (result.cancelled) {
		markDiagnosticCancelled(span, "progress");
	} else {
		markDiagnosticFailure(span, result.error);
	}
	return false;
}

function markDiagnosticCancelled(
	span: Span,
	stage: DiagnosticCancelStage,
): void {
	span.setProperty("cancel.stage", stage);
	span.markAborted();
}

function markDiagnosticFailure(
	span: Span,
	error: unknown,
	category: DiagnosticFailureCategory = categorizeFailure(error),
): void {
	span.setProperty("failure.category", category);
	span.markFailure();
}

function setSpeedtestSuccess(span: Span, rawJson: string): SpeedtestResult {
	const parsed = parseSpeedtestResult(rawJson);
	span.setMeasurement("intervalCount", parsed.intervals.length);
	span.setMeasurement("throughputMbits", parsed.overall.throughput_mbits);
	return parsed;
}

function categorizeFailure(error: unknown): DiagnosticFailureCategory {
	if (isAbortError(error)) {
		return "aborted";
	}
	return "error";
}

function categorizeWorkspaceOpenFailure(
	error: unknown,
): WorkspaceOpenFailureCategory {
	if (isAbortError(error)) {
		return "aborted";
	}
	return "error";
}

function bucketWorkspaceStatus(workspace: Workspace): WorkspaceStateBucket {
	switch (workspace.latest_build.status) {
		case "running":
		case "stopped":
		case "failed":
		case "starting":
		case "stopping":
		case "pending":
		case "deleting":
		case "deleted":
		case "canceled":
		case "canceling":
			return workspace.latest_build.status;
		default:
			return "unknown";
	}
}

function bucketAgentStatus(agent: WorkspaceAgent): AgentStatusBucket {
	switch (agent.status) {
		case "connected":
		case "connecting":
		case "disconnected":
		case "timeout":
			return agent.status;
		default:
			return "unknown";
	}
}

function bucketAgentLifecycle(agent: WorkspaceAgent): AgentLifecycleBucket {
	switch (agent.lifecycle_state) {
		case "ready":
		case "starting":
		case "created":
		case "start_error":
		case "start_timeout":
		case "shutting_down":
		case "off":
		case "shutdown_error":
		case "shutdown_timeout":
			return agent.lifecycle_state;
		default:
			return "unknown";
	}
}

function categorizeDevcontainerFailure(
	error: unknown,
): DevcontainerFailureCategory {
	if (isAbortError(error)) {
		return "aborted";
	}
	return "error";
}
