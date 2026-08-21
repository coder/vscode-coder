import { WorkspaceUpdateCancelledError } from "../api/updateParameters";
import {
	INITIAL_STATE,
	type AgentStateTransition,
	type WorkspaceStateTransition,
} from "../workspace/observers";

import type { WorkspaceBuildParameter } from "coder/site/src/api/typesGenerated";

import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type WorkspacePromptAction = "start" | "update";
export type WorkspaceUpdatePrompt = "parameters" | "confirmation";

/**
 * Emits `workspace.state_transitioned` for a detected workspace transition.
 * Telemetry only; pair with `WorkspaceStateObserver`.
 */
export function recordWorkspaceState(
	telemetry: TelemetryReporter,
	workspaceName: string,
	transition: WorkspaceStateTransition,
): void {
	const measurements: Record<string, number> = {};
	if (transition.durationMs !== undefined) {
		measurements.observed_duration_ms = transition.durationMs;
	}
	if (transition.buildDurationMs !== undefined) {
		measurements.observed_build_duration_ms = transition.buildDurationMs;
	}

	telemetry.log(
		"workspace.state_transitioned",
		{
			workspace_name: workspaceName,
			from: transition.from ?? INITIAL_STATE,
			to: transition.to,
			"build.transition": transition.buildTransition,
			"build.reason": transition.buildReason,
		},
		measurements,
	);
}

/**
 * Emits `workspace.agent.state_transitioned` for a detected agent transition.
 * Telemetry only; pair with `WorkspaceAgentObserver`.
 */
export function recordAgentState(
	telemetry: TelemetryReporter,
	workspaceName: string,
	transition: AgentStateTransition,
): void {
	telemetry.log(
		"workspace.agent.state_transitioned",
		{
			workspace_name: workspaceName,
			agent_name: transition.agentName,
			"status.from": transition.statusFrom ?? INITIAL_STATE,
			"status.to": transition.statusTo,
			"lifecycle_state.from": transition.lifecycleFrom ?? INITIAL_STATE,
			"lifecycle_state.to": transition.lifecycleTo,
		},
		transition.durationMs !== undefined
			? { observed_duration_ms: transition.durationMs }
			: {},
	);
}

/**
 * Wraps user-initiated workspace operations (start, update) as traced spans.
 * Stateless; safe to construct per call site.
 */
export class WorkspaceOperationTelemetry {
	public constructor(
		private readonly telemetry: TelemetryReporter,
		private readonly workspaceName: string,
	) {}

	public traceUpdate<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.update.triggered", fn, {
			workspace_name: this.workspaceName,
		});
	}

	public traceStart<T>(fn: () => Promise<T>): Promise<T> {
		return this.telemetry.trace("workspace.start.triggered", fn, {
			workspace_name: this.workspaceName,
		});
	}

	public async traceStartPrompt(
		outdated: boolean,
		fn: () => Promise<WorkspacePromptAction | undefined>,
	): Promise<WorkspacePromptAction | undefined> {
		return this.telemetry.trace(
			"workspace.start.prompted",
			async (span) => {
				const action = await fn();
				if (!action) {
					span.markAborted();
					return undefined;
				}
				span.setProperty("action", action);
				return action;
			},
			{ workspace_name: this.workspaceName, update_offered: outdated },
		);
	}

	/**
	 * Records dismissal as `result: "aborted"`. The framework treats any throw
	 * as `result: "error"`, so we return inside the span and rethrow outside.
	 */
	public async traceParametersPrompt(
		fn: () => Promise<WorkspaceBuildParameter[]>,
	): Promise<WorkspaceBuildParameter[]> {
		let cancelled: WorkspaceUpdateCancelledError | undefined;
		const parameters = await this.traceUpdatePrompt(
			"parameters",
			async (span) => {
				try {
					return await fn();
				} catch (error) {
					if (error instanceof WorkspaceUpdateCancelledError) {
						span.markAborted();
						cancelled = error;
						return [];
					}
					throw error;
				}
			},
		);
		if (cancelled) {
			throw cancelled;
		}
		return parameters;
	}

	public traceConfirmationPrompt<T>(
		fn: () => Promise<T | undefined>,
	): Promise<T | undefined> {
		return this.traceUpdatePrompt("confirmation", async (span) => {
			const value = await fn();
			if (value === undefined) {
				span.markAborted();
				return undefined;
			}
			span.setProperty("action", "update");
			return value;
		});
	}

	private traceUpdatePrompt<T>(
		prompt: WorkspaceUpdatePrompt,
		fn: (span: Span) => Promise<T>,
	): Promise<T> {
		return this.telemetry.trace("workspace.update.prompted", fn, {
			prompt,
			workspace_name: this.workspaceName,
		});
	}
}
