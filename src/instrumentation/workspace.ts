import { WorkspaceUpdateCancelledError } from "../api/updateParameters";
import {
	INITIAL_STATE,
	type AgentStateTransition,
	type WorkspaceStateTransition,
} from "../workspace/observers";

import type { WorkspaceBuildParameter } from "coder/site/src/api/typesGenerated";

import type { WorkspaceAction } from "@repo/shared";

import type { CallerProperties } from "../telemetry/event";
import type { TelemetryReporter } from "../telemetry/reporter";
import type { Span } from "../telemetry/span";

export type WorkspacePromptAction = "start" | "update";
export type WorkspaceUpdatePrompt = "parameters" | "confirmation" | "failure";

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
 * Wraps user-initiated workspace operations as traced spans.
 * Stateless; safe to construct per call site.
 */
export class WorkspaceOperationTelemetry {
	public constructor(
		private readonly telemetry: TelemetryReporter,
		private readonly workspaceName: string,
	) {}

	/** Emits `workspace.<action>.triggered` around `fn`; a refused update is aborted. */
	public traceAction<T>(
		action: WorkspaceAction,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.traceCancellable(
			`workspace.${action}.triggered`,
			{ workspace_name: this.workspaceName },
			fn,
		);
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

	/** Records dismissal as `result: "aborted"`. */
	public traceParametersPrompt(
		fn: () => Promise<WorkspaceBuildParameter[]>,
	): Promise<WorkspaceBuildParameter[]> {
		return this.traceCancellable(
			"workspace.update.prompted",
			{ prompt: "parameters", workspace_name: this.workspaceName },
			fn,
		);
	}

	public traceConfirmationPrompt<T>(
		fn: () => Promise<T | undefined>,
	): Promise<T | undefined> {
		return this.tracePromptChoice("confirmation", "update", fn);
	}

	/** Records whether the user connects to the existing version anyway. */
	public traceFailurePrompt(fn: () => Promise<boolean>): Promise<boolean> {
		return this.tracePromptChoice("failure", "connect", fn);
	}

	/** Emits the prompt with `action`, or marks it aborted on a falsy answer. */
	private tracePromptChoice<T>(
		prompt: WorkspaceUpdatePrompt,
		action: string,
		fn: () => Promise<T>,
	): Promise<T> {
		return this.traceUpdatePrompt(prompt, async (span) => {
			const value = await fn();
			if (!value) {
				span.markAborted();
				return value;
			}
			span.setProperty("action", action);
			return value;
		});
	}

	/**
	 * Records a dismissed or refused update as `result: "aborted"`. The
	 * framework treats any throw as an error, so the cancellation is returned
	 * from the span and rethrown outside it.
	 */
	private async traceCancellable<T>(
		eventName: string,
		properties: CallerProperties,
		fn: () => Promise<T>,
	): Promise<T> {
		const outcome = await this.telemetry.trace(
			eventName,
			async (
				span,
			): Promise<
				{ value: T } | { cancelled: WorkspaceUpdateCancelledError }
			> => {
				try {
					return { value: await fn() };
				} catch (error) {
					if (!(error instanceof WorkspaceUpdateCancelledError)) {
						throw error;
					}
					span.markAborted();
					return { cancelled: error };
				}
			},
			properties,
		);
		if ("cancelled" in outcome) {
			throw outcome.cancelled;
		}
		return outcome.value;
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
