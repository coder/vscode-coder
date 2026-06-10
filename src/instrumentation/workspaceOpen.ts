import { extractAgents } from "../api/api-helper";

import {
	type AbortableFailureCategory,
	categorizeAbortableFailure,
	recordCancelled,
	recordFailure,
} from "./outcomes";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CallerProperties } from "../telemetry/event";
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
export type DevcontainerMode = "dev_container" | "attached_container";
export type WorkspaceOpenCancelStage =
	| "workspace_picker"
	| "agent_picker"
	| "recent_folder_picker";

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

/**
 * Emits the spans around opening a workspace: `workspace.open`,
 * `workspace.picker.prompted`, and `workspace.dev_container.open`.
 */
export class WorkspaceOpenTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceOpen(
		source: WorkspaceOpenSource,
		selection: WorkspaceOpenSelection | undefined,
		fn: (trace: WorkspaceOpenTrace) => Promise<boolean>,
	): Promise<boolean> {
		return this.traceRethrowing(
			"workspace.open",
			{ source },
			false,
			async (span) => {
				const trace = new SpanWorkspaceOpenTrace(span);
				if (selection) {
					trace.select(selection);
				}
				const opened = await fn(trace);
				if (!opened) {
					span.markAborted();
				}
				return opened;
			},
		);
	}

	public tracePicker(
		source: WorkspacePickerSource,
		fn: (trace: WorkspacePickerTrace) => Promise<WorkspacePickerResult>,
	): Promise<WorkspacePickerResult> {
		return this.telemetry.trace(
			"workspace.picker.prompted",
			(span) => fn(new SpanWorkspacePickerTrace(span)),
			{ source },
		);
	}

	public async traceDevcontainer(
		mode: DevcontainerMode,
		fn: () => Promise<void>,
	): Promise<void> {
		await this.traceRethrowing(
			"workspace.dev_container.open",
			{ mode },
			undefined,
			fn,
		);
	}

	/**
	 * Runs `fn` inside the span, recording a thrown error as a categorized
	 * failure without its raw details, then rethrows outside the span.
	 */
	private async traceRethrowing<T>(
		eventName: string,
		properties: CallerProperties,
		fallback: T,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		let thrown: { readonly error: unknown } | undefined;
		const result = await this.telemetry.trace(
			eventName,
			async (span) => {
				try {
					return await fn(span);
				} catch (error) {
					thrown = { error };
					recordFailure(span, categorizeAbortableFailure(error));
					return fallback;
				}
			},
			properties,
		);
		if (thrown) {
			throw thrown.error;
		}
		return result;
	}
}

class SpanWorkspacePickerTrace implements WorkspacePickerTrace {
	public constructor(private readonly span: Span) {}

	public finish(result: WorkspacePickerResult, resultCount: number): void {
		this.span.setMeasurement("workspace_count", resultCount);
		if (result.status === "selected") {
			recordWorkspaceContext(this.span, result.workspace);
			return;
		}
		if (result.status === "failed") {
			recordFailure(this.span, result.category);
			return;
		}
		this.span.markAborted();
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
		if (selection) {
			recordWorkspaceContext(this.span, selection.workspace, selection.agent);
		}
		recordCancelled(this.span, stage);
	}

	public fail(category: WorkspaceOpenFailureCategory): void {
		recordFailure(this.span, category);
	}

	public handoff(kind: "folder" | "empty_window"): void {
		this.span.setProperty("handoff", kind);
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
