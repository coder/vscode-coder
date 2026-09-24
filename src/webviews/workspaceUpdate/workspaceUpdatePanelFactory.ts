import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	hasErrorDiagnostics,
	WorkspaceUpdateApi,
	type ParameterValues,
	type WorkspaceUpdateInit,
} from "@repo/shared";

import { WorkspaceUpdateCancelledError } from "../../api/updateParameters";
import { dispatchWebviewMessage } from "../dispatch";
import { getWebviewHtml } from "../html";

import type {
	DynamicParametersResponse,
	PreviewParameter,
	Workspace,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "../../api/coderApi";
import type { Logger } from "../../logging/logger";

type Evaluate = (inputs: ParameterValues) => Promise<DynamicParametersResponse>;

/** Collects dynamic parameters for an update, like the dashboard. */
export class WorkspaceUpdatePanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	/** Asks only when the current values fail; closing the form cancels. */
	public async collectParameters(
		client: CoderApi,
		workspace: Workspace,
	): Promise<WorkspaceBuildParameter[]> {
		const evaluate: Evaluate = async (inputs) => {
			const response = await client.getTemplateVersionDynamicParameters(
				workspace.template_active_version_id,
				{ id: 0, owner_id: workspace.owner_id, inputs },
			);
			// The server sends null for empty lists.
			return {
				...response,
				parameters: response.parameters ?? [],
				diagnostics: response.diagnostics ?? [],
			};
		};

		const previous = Object.fromEntries(
			(await client.getWorkspaceBuildParameters(workspace.latest_build.id)).map(
				({ name, value }) => [name, value],
			),
		);
		const evaluation = await evaluate(previous);
		if (!hasErrorDiagnostics(evaluation)) {
			return [];
		}
		return this.showForm(
			{
				workspaceName: `${workspace.owner_name}/${workspace.name}`,
				values: acceptedValues(evaluation.parameters, previous),
				restart: workspace.latest_build.status === "running",
			},
			evaluate,
		);
	}

	private showForm(
		init: WorkspaceUpdateInit,
		evaluate: Evaluate,
	): Promise<WorkspaceBuildParameter[]> {
		const title = `Update ${init.workspaceName}`;
		const panel = vscode.window.createWebviewPanel(
			"coder.workspaceUpdate",
			title,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(
						this.extensionUri,
						"dist",
						"webviews",
						"workspace-update",
					),
				],
			},
		);
		panel.iconPath = {
			light: vscode.Uri.joinPath(this.extensionUri, "media", "logo-black.svg"),
			dark: vscode.Uri.joinPath(this.extensionUri, "media", "logo-white.svg"),
		};
		panel.webview.html = getWebviewHtml(
			panel.webview,
			this.extensionUri,
			"workspace-update",
			title,
		);

		return new Promise((resolve, reject) => {
			const commands = buildCommandHandlers(WorkspaceUpdateApi, {
				submit: (values) => {
					resolve(
						Object.entries(values).map(([name, value]) => ({ name, value })),
					);
					panel.dispose();
				},
				cancel: () => {
					panel.dispose();
				},
			});
			const requests = buildRequestHandlers(WorkspaceUpdateApi, {
				init: () => Promise.resolve(init),
				evaluate,
			});
			const listener = panel.webview.onDidReceiveMessage((message: unknown) =>
				dispatchWebviewMessage(message, { commands, requests }, panel.webview, {
					logger: this.logger,
				}),
			);
			panel.onDidDispose(() => {
				listener.dispose();
				// No-op once submit has resolved.
				reject(new WorkspaceUpdateCancelledError());
			});
		});
	}
}

/** Like the dashboard's `getInitialParameterValues`. */
function acceptedValues(
	parameters: readonly PreviewParameter[],
	previous: ParameterValues,
): ParameterValues {
	return Object.fromEntries(
		parameters.flatMap((parameter) => {
			const value = previous[parameter.name];
			return value === undefined ||
				parameter.ephemeral ||
				!isValidOption(parameter, value)
				? []
				: [[parameter.name, value]];
		}),
	);
}

function isValidOption(parameter: PreviewParameter, value: string): boolean {
	if (parameter.options.length === 0) {
		return true;
	}
	const options = new Set(parameter.options.map((o) => o.value.value));
	if (parameter.form_type !== "multi-select") {
		return options.has(value);
	}
	try {
		const selected: unknown = JSON.parse(value);
		return (
			Array.isArray(selected) && selected.some((v) => options.has(String(v)))
		);
	} catch {
		return false;
	}
}
