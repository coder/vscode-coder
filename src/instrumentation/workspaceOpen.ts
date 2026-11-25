import { extractAgents } from "../api/models";

import { recordAbortableError, recordAborted, recordError } from "./outcomes";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CallerProperties } from "../telemetry/event";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

import type { RemoteSetupPhase } from "./remoteSetup";

export type WorkspaceOpenSource =
	| "command"
	| "sidebar_agent"
	| "sidebar_workspace"
	| "sidebar_fallback"
	| "uri";

export type WorkspacePickerSource = "workspace_open" | "diagnostic";
export type WorkspacePickerErrorCategory = "fetch_error";
export type WorkspaceOpenErrorCategory = WorkspacePickerErrorCategory | "error";
export type WorkspacePickerResult =
	| { readonly status: "selected"; readonly workspace: Workspace }
	| { readonly status: "cancelled" }
	| {
			readonly status: "failed";
			readonly category: WorkspacePickerErrorCategory;
	  };
export type DevContainerMode = "dev_container" | "attached_container";
export type WorkspaceOpenAbortStage =
	| "workspace_picker"
	| "agent_picker"
	| "recent_folder_picker"
	| "start_prompt";
/** `remote.setup` phases that opening in the Agents window shares. */
export type AgentsWindowPhase = Extract<
	RemoteSetupPhase,
	| "cli_resolve"
	| "compatibility_check"
	| "cli_configure"
	| "workspace_monitor_setup"
	| "workspace_ready"
	| "ssh_config_write"
>;

export interface WorkspaceOpenSelection {
	readonly workspace: Workspace;
	readonly agent?: WorkspaceAgent;
}

export interface WorkspacePickerTrace {
	finish(result: WorkspacePickerResult, resultCount: number): void;
}

export interface WorkspaceOpenTrace {
	select(selection: WorkspaceOpenSelection): void;
	abort(
		stage: WorkspaceOpenAbortStage,
		selection?: WorkspaceOpenSelection,
	): void;
	error(category: WorkspaceOpenErrorCategory): void;
	handoff(kind: "folder" | "empty_window"): void;
}

export interface AgentsWindowOpenTrace extends WorkspaceOpenTrace {
	phase<T>(name: AgentsWindowPhase, fn: () => Promise<T>): Promise<T>;
}

/**
 * Emits the spans around opening a workspace: `workspace.open`,
 * `workspace.picker.prompted`, `workspace.dev_container.open`, and
 * `workspace.agents_window.open`.
 */
export class WorkspaceOpenTelemetry {
	public constructor(private readonly telemetry: TelemetryReporter) {}

	public traceOpen(
		source: WorkspaceOpenSource,
		selection: WorkspaceOpenSelection | undefined,
		fn: (trace: WorkspaceOpenTrace) => Promise<boolean>,
	): Promise<boolean> {
		return this.traceOpening("workspace.open", { source }, (span) => {
			const trace = new SpanWorkspaceOpenTrace(span);
			if (selection) {
				trace.select(selection);
			}
			return fn(trace);
		});
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

	public async traceDevContainer(
		mode: DevContainerMode,
		fn: () => Promise<void>,
	): Promise<void> {
		await this.traceRethrowing(
			"workspace.dev_container.open",
			{ mode },
			undefined,
			fn,
		);
	}

	public traceAgentsWindow(
		fn: (trace: AgentsWindowOpenTrace) => Promise<boolean>,
	): Promise<boolean> {
		return this.traceOpening("workspace.agents_window.open", {}, (span) =>
			fn(new SpanAgentsWindowOpenTrace(span)),
		);
	}

	/** Like {@link traceRethrowing}, marking the span aborted when nothing opened. */
	private traceOpening(
		eventName: string,
		properties: CallerProperties,
		fn: (span: Span) => Promise<boolean>,
	): Promise<boolean> {
		return this.traceRethrowing(eventName, properties, false, async (span) => {
			const opened = await fn(span);
			if (!opened) {
				span.markAborted();
			}
			return opened;
		});
	}

	/**
	 * Runs `fn` inside the span, recording a thrown abort as `aborted` and any
	 * other error as a categorized error without its raw details, then rethrows
	 * outside the span.
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
					recordAbortableError(span, error);
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
		this.span.setMeasurement("workspace.count", resultCount);
		if (result.status === "selected") {
			recordWorkspaceContext(this.span, result.workspace);
			return;
		}
		if (result.status === "failed") {
			recordError(this.span, result.category);
			return;
		}
		this.span.markAborted();
	}
}

class SpanWorkspaceOpenTrace implements WorkspaceOpenTrace {
	public constructor(protected readonly span: Span) {}

	public select(selection: WorkspaceOpenSelection): void {
		recordWorkspaceContext(this.span, selection.workspace, selection.agent);
	}

	public abort(
		stage: WorkspaceOpenAbortStage,
		selection?: WorkspaceOpenSelection,
	): void {
		if (selection) {
			recordWorkspaceContext(this.span, selection.workspace, selection.agent);
		}
		recordAborted(this.span, stage);
	}

	public error(category: WorkspaceOpenErrorCategory): void {
		recordError(this.span, category);
	}

	public handoff(kind: "folder" | "empty_window"): void {
		this.span.setProperty("handoff", kind);
	}
}

class SpanAgentsWindowOpenTrace
	extends SpanWorkspaceOpenTrace
	implements AgentsWindowOpenTrace
{
	public phase<T>(name: AgentsWindowPhase, fn: () => Promise<T>): Promise<T> {
		return this.span.phase(name, fn);
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
	span.setMeasurement("agent.count", agents.length);
	span.setMeasurement(
		"agent.connected_count",
		agents.filter((candidate) => candidate.status === "connected").length,
	);
	if (!agent) {
		return;
	}
	span.setProperty("agent_status", agent.status);
	span.setProperty("agent_lifecycle_state", agent.lifecycle_state);
}
