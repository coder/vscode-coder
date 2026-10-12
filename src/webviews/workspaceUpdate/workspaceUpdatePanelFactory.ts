import {
	buildCommandHandlers,
	buildRequestHandlers,
	WorkspaceUpdateApi,
	type WorkspaceUpdateInit,
} from "@repo/shared";

import { WorkspaceUpdateCancelledError } from "../../api/updateParameters";
import { createCoderPanel } from "../coderPanel";

import type { WorkspaceBuildParameter } from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { EvaluateParameters } from "../../api/dynamicParameters";
import type { Logger } from "../../logging/logger";

export class WorkspaceUpdatePanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	/** Resolves with the submitted values; closing the form cancels. */
	public show(
		init: WorkspaceUpdateInit,
		evaluate: EvaluateParameters,
	): Promise<WorkspaceBuildParameter[]> {
		return new Promise((resolve, reject) => {
			const panel = createCoderPanel({
				extensionUri: this.extensionUri,
				logger: this.logger,
				viewType: "coder.workspaceUpdate",
				webviewName: "workspace-update",
				title: `Update ${init.workspaceName}`,
				buildHandlers: (created) => ({
					commands: buildCommandHandlers(WorkspaceUpdateApi, {
						submit: (values) => {
							resolve(
								Object.entries(values).map(([name, value]) => ({
									name,
									value,
								})),
							);
							created.dispose();
						},
						cancel: () => {
							created.dispose();
						},
					}),
					requests: buildRequestHandlers(WorkspaceUpdateApi, {
						init: () => Promise.resolve(init),
						evaluate,
					}),
				}),
			});
			// No-op once submit has resolved.
			panel.onDidDispose(() => reject(new WorkspaceUpdateCancelledError()));
		});
	}
}
