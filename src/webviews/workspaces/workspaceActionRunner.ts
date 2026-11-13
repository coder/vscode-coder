import * as semver from "semver";
import * as vscode from "vscode";

import { workspaceActions, type WorkspaceAction } from "@repo/shared";

import {
	createWorkspaceIdentifier,
	workspaceStatusLabel,
} from "../../api/models";
import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "../../api/updateParameters";
import {
	restartWorkspace,
	runBuild,
	startWorkspaceViaApi,
	updateChangedError,
	updateWorkspaceViaApi,
	type BuildContext,
	type Write,
} from "../../api/workspace";
import { throwIfAborted } from "../../error/abort";
import { errToStr } from "../../error/normalize";
import { serverFeatureSet } from "../../featureSet";
import { WorkspaceOperationTelemetry } from "../../instrumentation/workspace";
import { vscodeProposed } from "../../vscode/proposed";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "../../api/coderApi";
import type { Commands } from "../../commands";
import type { SessionState } from "../../deployment/sessionStore";
import type { Logger } from "../../logging/logger";
import type { TelemetryReporter } from "../../telemetry/reporter";

const RESTART_WARNING =
	"stops any running processes and may result in the loss of unsaved work.";

/**
 * Runs the lifecycle actions the Workspaces panel requests, over the REST
 * API. Each action asks first where it must, re-reads the workspace, waits
 * for its builds, and halts once the session changes.
 */
export class WorkspaceActionRunner {
	constructor(
		private readonly client: CoderApi,
		private readonly session: SessionState,
		private readonly connected: Pick<Commands, "workspace" | "updateWorkspace">,
		private readonly telemetry: TelemetryReporter,
		private readonly logger: Logger,
	) {}

	public async run(listed: Workspace, action: WorkspaceAction): Promise<void> {
		const connected = listed.id === this.connected.workspace?.id;
		// A reload updates the connected workspace, so the remote setup follows.
		if (action === "update" && connected) {
			return this.connected.updateWorkspace();
		}
		const name = createWorkspaceIdentifier(listed);
		const telemetry = new WorkspaceOperationTelemetry(this.telemetry, name);
		// The client is shared, so a request after a session change would act
		// as another user or on another deployment.
		const abort = new AbortController();
		const sessionChange = this.session.onDidChange(() => abort.abort());
		const ctx: BuildContext = {
			client: this.client,
			write: this.writer(name),
			signal: abort.signal,
		};
		try {
			if (!(await this.confirm(listed, action, connected, telemetry))) {
				return;
			}
			const latest = await this.reread(listed, action, abort.signal);
			if (latest) {
				await this.perform(ctx, latest, action, telemetry);
			}
		} catch (error) {
			if (abort.signal.aborted) {
				void vscode.window.showInformationMessage(
					"The Coder session changed. The workspace action was halted; check its status before retrying.",
				);
				return;
			}
			if (error instanceof WorkspaceUpdateCancelledError) {
				if (error.reason) {
					void vscode.window.showInformationMessage(error.reason);
				}
				return;
			}
			throw new Error(
				`Failed to ${action} ${name}: ${errToStr(error)}. The Coder output has its build logs.`,
				{ cause: error },
			);
		} finally {
			sessionChange.dispose();
		}
	}

	private async confirm(
		listed: Workspace,
		action: WorkspaceAction,
		connected: boolean,
		telemetry: WorkspaceOperationTelemetry,
	): Promise<boolean> {
		const name = createWorkspaceIdentifier(listed);
		if (action === "delete") {
			return confirmModal(
				`Delete ${name}?`,
				"This permanently deletes the workspace and all of its data.",
				"Delete",
			);
		}
		if (action === "update") {
			const running = listed.latest_build.status === "running";
			const confirmed = await telemetry.traceConfirmationPrompt(() =>
				confirmModal(
					"Update Workspace",
					running
						? `Update ${name} to the latest version?\n\nUpdating will restart your workspace which ${RESTART_WARNING}`
						: `Update ${name} to the latest version?\n\nThe workspace will start on the latest version.`,
					running ? "Update and Restart" : "Update and Start",
				),
			);
			return confirmed === true;
		}
		if (action === "start" || !connected) {
			return true;
		}
		const [verb, doing] =
			action === "stop" ? ["Stop", "Stopping"] : ["Restart", "Restarting"];
		return confirmModal(
			`${verb} ${name}?`,
			`This window is connected to ${name}. ${doing} it ${RESTART_WARNING}`,
			verb,
		);
	}

	/** The listed copy may be stale, so re-read it and explain a refusal. */
	private async reread(
		listed: Workspace,
		action: WorkspaceAction,
		signal: AbortSignal,
	): Promise<Workspace | undefined> {
		throwIfAborted(signal);
		const latest = await this.client.getWorkspace(listed.id);
		throwIfAborted(signal);
		const name = createWorkspaceIdentifier(latest);
		if (!workspaceActions(latest).includes(action)) {
			const status = workspaceStatusLabel(
				latest.latest_build.status,
			).toLowerCase();
			void vscode.window.showInformationMessage(
				action === "update" && !latest.outdated
					? `${name} is already up to date.`
					: `Cannot ${action} ${name} while it is ${status}.`,
			);
			return undefined;
		}
		// The update confirmation named a start or a restart.
		const running = (w: Workspace) => w.latest_build.status === "running";
		if (action === "update" && running(listed) !== running(latest)) {
			throw updateChangedError(name);
		}
		return latest;
	}

	/** Queues the action's builds and waits for them, logging as `coder` does. */
	private async perform(
		ctx: BuildContext,
		workspace: Workspace,
		action: WorkspaceAction,
		telemetry: WorkspaceOperationTelemetry,
	): Promise<void> {
		if (action === "update") {
			const parameters = await telemetry.traceParametersPrompt(() =>
				collectUpdateParameters(this.client, workspace),
			);
			const { version } = await this.client.getBuildInfo();
			const serverFeatures = serverFeatureSet(semver.parse(version));
			return telemetry.traceAction("update", () =>
				updateWorkspaceViaApi(ctx, workspace, serverFeatures, parameters),
			);
		}
		const builds = {
			start: () => startWorkspaceViaApi(ctx, workspace),
			stop: () => runBuild(ctx, workspace.id, { transition: "stop" }),
			restart: () => restartWorkspace(ctx, workspace),
			delete: () => runBuild(ctx, workspace.id, { transition: "delete" }),
		}[action];
		await telemetry.traceAction(action, builds);
	}

	/** Writes each line to the Coder output, tagged with the workspace. */
	private writer(name: string): Write {
		return (data) => {
			for (const line of data.split(/\r?\n|\r/)) {
				if (line.trim()) {
					this.logger.info(`[${name}] ${line}`);
				}
			}
		};
	}
}

/** True when the user chose `button` in a modal warning. */
async function confirmModal(
	title: string,
	detail: string,
	button: string,
): Promise<boolean> {
	const choice = await vscodeProposed.window.showWarningMessage(
		title,
		{ useCustom: true, modal: true, detail },
		button,
	);
	return choice === button;
}
