import { setTimeout as delayTimer } from "node:timers/promises";

import type { AxiosInstance } from "axios";
import type {
	DynamicParametersResponse,
	FriendlyDiagnostic,
	PreviewParameter,
	Workspace,
	WorkspaceBuild,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

import type { WorkspaceUpdateState } from "@repo/shared";

import type { CoderApi } from "./coderApi";

const EVALUATION_DEBOUNCE_MS = 250;
const BUILD_POLL_INTERVAL_MS = 1_000;

/**
 * Keeps a dynamic-parameter update form in sync with Coder's authoritative
 * evaluator. It does not create a build until submit succeeds its guards.
 */
export class DynamicUpdateSession {
	public state: WorkspaceUpdateState;

	private readonly axios: AxiosInstance;
	private readonly sourceBuild: WorkspaceBuild;
	private readonly targetVersionId: string;
	private previousInputs: Readonly<Record<string, string>> = {};
	private evaluationInputs: Readonly<Record<string, string>> = {};
	private timer: ReturnType<typeof setTimeout> | undefined;
	private evaluationController: AbortController | undefined;
	private evaluationGeneration = 0;
	private lastSuccessfulRevision = 0;
	private retryAllowed = false;
	private initialized = false;
	private resetEphemeral = true;
	private priorDiagnostics: readonly FriendlyDiagnostic[] = [];
	private finished = false;
	private readonly lifetime = new AbortController();
	private disposed = false;
	private submitting = false;

	constructor(
		client: CoderApi,
		private readonly workspace: Workspace,
		private readonly onState: (state: WorkspaceUpdateState) => void,
	) {
		this.axios = client.getAxiosInstance();
		this.sourceBuild = workspace.latest_build;
		this.targetVersionId = workspace.template_active_version_id;
		this.state = {
			workspaceName: `${workspace.owner_name}/${workspace.name}`,
			templateVersionId: this.targetVersionId,
			revision: 0,
			status: "loading",
			parameters: [],
			inputs: {},
			locked: [],
			diagnostics: [],
			canSubmit: false,
		};
	}

	/** Loads saved parameters and evaluates the pinned target template version. */
	public async initialize(): Promise<void> {
		if (this.disposed) return;
		this.publish({ status: "loading", error: undefined, canSubmit: false });
		try {
			const response = await this.axios.get<WorkspaceBuildParameter[]>(
				`/api/v2/workspacebuilds/${this.sourceBuild.id}/parameters`,
				{ sensitive: true },
			);
			if (this.disposed) return;

			const previous = Object.fromEntries(
				response.data.map((parameter) => [parameter.name, parameter.value]),
			);
			this.previousInputs = previous;
			this.evaluationInputs = previous;
			this.initialized = true;
			await this.evaluate(previous, true);
		} catch {
			this.evaluationFailed();
		}
	}

	/** Changes an editable value and evaluates it after a short debounce. */
	public change(name: string, value: string): void {
		if (
			this.disposed ||
			this.submitting ||
			this.finished ||
			this.state.locked.includes(name) ||
			!this.state.parameters.some(
				(parameter) =>
					parameter.name === name &&
					!parameter.styling.disabled &&
					parameter.form_type !== "error",
			)
		) {
			return;
		}
		this.evaluationGeneration++;
		this.evaluationController?.abort();
		this.evaluationInputs = { ...this.evaluationInputs, [name]: value };
		this.publish({
			inputs: { ...this.state.inputs, [name]: value },
			status: "evaluating",
			error: undefined,
			canSubmit: false,
		});
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.evaluate(this.evaluationInputs, false);
		}, EVALUATION_DEBOUNCE_MS);
	}

	/** Retries a failed evaluation. Build submission failures are intentionally not retried. */
	public async retry(): Promise<void> {
		if (
			this.disposed ||
			this.submitting ||
			this.state.status !== "error" ||
			!this.retryAllowed
		) {
			return;
		}
		this.retryAllowed = false;
		if (!this.initialized) {
			await this.initialize();
			return;
		}
		this.publish({ status: "evaluating", error: undefined, canSubmit: false });
		await this.evaluate(this.evaluationInputs, this.resetEphemeral);
	}

	/**
	 * Stops a running source build, starts the exact target version, and waits for
	 * its completion. A build failure is ambiguous, so the session cannot retry it.
	 */
	public async submit(revision: number): Promise<boolean> {
		if (
			this.disposed ||
			this.submitting ||
			revision !== this.lastSuccessfulRevision ||
			!this.state.canSubmit
		) {
			return false;
		}
		this.submitting = true;
		this.finished = true;
		this.publish({ status: "submitting", error: undefined, canSubmit: false });
		try {
			const current = await this.getCurrentWorkspace();
			if (
				current.latest_build.id !== this.sourceBuild.id ||
				current.template_active_version_id !== this.targetVersionId
			) {
				throw new SafeSubmitError(
					"The workspace changed. Reopen the update form.",
				);
			}
			const builds = await this.getWorkspaceBuilds();
			if (builds[0]?.id !== this.sourceBuild.id) {
				throw new SafeSubmitError(
					"Another workspace build is in progress. Reopen the update form.",
				);
			}
			if (
				!["running", "stopped", "failed"].includes(current.latest_build.status)
			) {
				throw new SafeSubmitError(
					"Wait for the current build to finish, then reopen the update form.",
				);
			}
			if (current.latest_build.status === "running") {
				const stopBuild = await this.postBuild({ transition: "stop" });
				await this.waitForSucceededBuild(stopBuild);
			}

			const startBuild = await this.postBuild({
				transition: "start",
				template_version_id: this.targetVersionId,
				rich_parameter_values: parameterValues(this.state.inputs),
				reason: "vscode_connection",
			});
			await this.waitForSucceededBuild(startBuild);
			const updated = await this.getCurrentWorkspace();
			if (
				updated.latest_build.id !== startBuild.id ||
				updated.latest_build.template_version_id !== this.targetVersionId
			) {
				throw new SafeSubmitError(
					"The workspace changed while the update was running. Reopen the update form.",
				);
			}
			this.retryAllowed = false;
			this.publish({ status: "success", error: undefined, canSubmit: false });
			return true;
		} catch (error) {
			const message =
				error instanceof SafeSubmitError
					? error.message
					: "The workspace update may have started. Reopen the update form before trying again.";
			this.retryAllowed = false;
			this.publish({ status: "error", error: message, canSubmit: false });
			return false;
		} finally {
			this.submitting = false;
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.lifetime.abort();
		this.previousInputs = {};
		this.evaluationInputs = {};
		this.priorDiagnostics = [];
		this.state = { ...this.state, inputs: {}, parameters: [], diagnostics: [] };
		clearTimeout(this.timer);
		this.timer = undefined;
		this.evaluationController?.abort();
		this.evaluationController = undefined;
	}

	private async evaluate(
		inputs: Readonly<Record<string, string>>,
		stripPreviousEphemeral: boolean,
	): Promise<void> {
		if (this.disposed || this.submitting) return;
		const generation = ++this.evaluationGeneration;
		this.evaluationController?.abort();
		const controller = new AbortController();
		this.evaluationController = controller;
		this.publish({ status: "evaluating", error: undefined, canSubmit: false });
		try {
			const result = await this.requestEvaluation(
				inputs,
				controller.signal,
				generation,
			);
			if (
				this.disposed ||
				controller.signal.aborted ||
				generation !== this.evaluationGeneration
			) {
				return;
			}
			if (stripPreviousEphemeral) {
				this.priorDiagnostics = result.diagnostics;
				const ephemeral = new Set(
					result.parameters
						.filter((parameter) => parameter.ephemeral)
						.map((parameter) => parameter.name),
				);
				const withoutEphemeral = omitKeys(inputs, ephemeral);
				this.evaluationInputs = withoutEphemeral;
				if (
					Object.keys(withoutEphemeral).length !== Object.keys(inputs).length
				) {
					this.resetEphemeral = false;
					await this.evaluate(withoutEphemeral, false);
					return;
				}
			}
			this.resetEphemeral = false;
			this.applyEvaluation(result, inputs);
		} catch {
			if (
				!this.disposed &&
				!controller.signal.aborted &&
				generation === this.evaluationGeneration
			) {
				this.evaluationFailed();
			}
		} finally {
			if (this.evaluationController === controller) {
				this.evaluationController = undefined;
			}
		}
	}

	private async requestEvaluation(
		inputs: Readonly<Record<string, string>>,
		signal: AbortSignal,
		generation: number,
	): Promise<DynamicParametersResponse> {
		const response = await this.axios.post<DynamicParametersResponse>(
			`/api/v2/templateversions/${this.targetVersionId}/dynamic-parameters/evaluate`,
			{ id: generation, owner_id: this.workspace.owner_id, inputs },
			{ sensitive: true, signal },
		);
		return {
			...response.data,
			parameters: response.data.parameters ?? [],
			diagnostics: response.data.diagnostics ?? [],
		};
	}

	private applyEvaluation(
		result: DynamicParametersResponse,
		requestedInputs: Readonly<Record<string, string>>,
	): void {
		const parameters = result.parameters.map((parameter) => {
			const previous = this.previousInputs[parameter.name];
			const monotonic =
				previous !== undefined &&
				parameter.type === "number" &&
				parameter.value.valid &&
				parameter.validations.some(
					(validation) =>
						(validation.validation_monotonic === "increasing" &&
							Number(parameter.value.value) < Number(previous)) ||
						(validation.validation_monotonic === "decreasing" &&
							Number(parameter.value.value) > Number(previous)),
				);
			return monotonic
				? {
						...parameter,
						diagnostics: [
							...parameter.diagnostics,
							{
								severity: "error" as const,
								summary: "Value violates the template's monotonic constraint.",
								detail:
									"Choose a value that respects the direction allowed relative to the previous build.",
								extra: { code: "monotonic" },
							},
						],
					}
				: parameter;
		});
		const diagnostics = [
			...new Map(
				[
					...this.priorDiagnostics,
					...allDiagnostics({ ...result, parameters }),
				].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
			).values(),
		];
		const locked = parameters.flatMap((parameter) =>
			parameter.styling.disabled ||
			(!parameter.mutable && Object.hasOwn(this.previousInputs, parameter.name))
				? [parameter.name]
				: [],
		);
		const inputs = inputsFromParameters(parameters, requestedInputs);
		this.lastSuccessfulRevision++;
		this.retryAllowed = false;
		this.publish({
			revision: this.lastSuccessfulRevision,
			status: "ready",
			parameters,
			inputs,
			locked,
			diagnostics,
			error: undefined,
			canSubmit:
				!hasErrors(diagnostics) &&
				parameters.every(
					(parameter) =>
						parameter.form_type !== "error" && parameter.value.valid,
				),
		});
	}

	private evaluationFailed(): void {
		this.retryAllowed = true;
		this.publish({
			status: "error",
			error: "Could not evaluate workspace parameters. Try again.",
			canSubmit: false,
		});
	}

	private async getCurrentWorkspace(): Promise<Workspace> {
		const response = await this.axios.get<Workspace>(
			`/api/v2/users/${this.workspace.owner_name}/workspace/${this.workspace.name}`,
			{ sensitive: true },
		);
		return response.data;
	}

	private async getWorkspaceBuilds(): Promise<readonly WorkspaceBuild[]> {
		const response = await this.axios.get<WorkspaceBuild[]>(
			`/api/v2/workspaces/${this.workspace.id}/builds?limit=1`,
			{ sensitive: true },
		);
		return response.data;
	}

	private async postBuild(data: {
		readonly transition: "start" | "stop";
		readonly template_version_id?: string;
		readonly rich_parameter_values?: readonly WorkspaceBuildParameter[];
		readonly reason?: "vscode_connection";
	}): Promise<WorkspaceBuild> {
		this.lifetime.signal.throwIfAborted();
		const response = await this.axios.post<WorkspaceBuild>(
			`/api/v2/workspaces/${this.workspace.id}/builds`,
			data,
			{ sensitive: true },
		);
		return response.data;
	}

	private async waitForSucceededBuild(build: WorkspaceBuild): Promise<void> {
		while (true) {
			this.lifetime.signal.throwIfAborted();
			const response = await this.axios.get<WorkspaceBuild>(
				`/api/v2/users/${build.workspace_owner_name}/workspace/${build.workspace_name}/builds/${build.build_number}`,
				{ sensitive: true },
			);
			this.lifetime.signal.throwIfAborted();
			if (response.data.job.status === "succeeded") return;
			if (["failed", "canceled"].includes(response.data.job.status)) {
				throw new Error("Build did not succeed");
			}
			await delay(BUILD_POLL_INTERVAL_MS, this.lifetime.signal);
		}
	}

	private publish(change: Partial<WorkspaceUpdateState>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...change, canRetry: this.retryAllowed };
		this.onState(this.state);
	}
}

class SafeSubmitError extends Error {}

function inputsFromParameters(
	parameters: readonly PreviewParameter[],
	requested: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	const values: Record<string, string> = Object.create(null) as Record<
		string,
		string
	>;
	for (const parameter of parameters) {
		if (Object.hasOwn(requested, parameter.name)) {
			values[parameter.name] = requested[parameter.name];
		} else if (parameter.value.valid) {
			values[parameter.name] = parameter.value.value;
		}
	}
	return values;
}

function allDiagnostics(
	result: DynamicParametersResponse,
): readonly FriendlyDiagnostic[] {
	return [
		...result.diagnostics,
		...result.parameters.flatMap((parameter) => parameter.diagnostics),
	];
}

function hasErrors(diagnostics: readonly FriendlyDiagnostic[]): boolean {
	return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function parameterValues(
	inputs: Readonly<Record<string, string>>,
): readonly WorkspaceBuildParameter[] {
	return Object.entries(inputs).map(([name, value]) => ({ name, value }));
}

function omitKeys(
	values: Readonly<Record<string, string>>,
	keys: ReadonlySet<string>,
): Readonly<Record<string, string>> {
	return Object.fromEntries(
		Object.entries(values).filter(([name]) => !keys.has(name)),
	);
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
	await delayTimer(milliseconds, undefined, { signal });
}
