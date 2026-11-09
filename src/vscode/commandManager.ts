import * as vscode from "vscode";

import { InputValidationError } from "../common/validation";
import { reportInputValidationError } from "../error/inputValidationError";
import { type TelemetryService } from "../telemetry/service";

import type { Logger } from "../logging/logger";

/**
 * Every `coder.*` command id contributed by this extension. Kept in sync with
 * `contributes.commands` in package.json by a unit test.
 */
export const CODER_COMMAND_IDS = [
	"coder.login",
	"coder.logout",
	"coder.switchDeployment",
	"coder.open",
	"coder.openDevContainer",
	"coder.openFromSidebar",
	"coder.openAppStatus",
	"coder.workspace.update",
	"coder.createWorkspace",
	"coder.navigateToWorkspace",
	"coder.navigateToWorkspaceSettings",
	"coder.refreshWorkspaces",
	"coder.viewLogs",
	"coder.openSshConfig",
	"coder.exportTelemetry",
	"coder.viewAnnouncements",
	"coder.searchMyWorkspaces",
	"coder.searchSharedWorkspaces",
	"coder.searchAllWorkspaces",
	"coder.manageCredentials",
	"coder.applyRecommendedSettings",
	"coder.pingWorkspace",
	"coder.pingWorkspace:views",
	"coder.speedTest",
	"coder.speedTest:views",
	"coder.netcheck",
	"coder.supportBundle",
	"coder.supportBundle:views",
	"coder.tasks.refresh",
	"coder.workspaces.refresh",
] as const;

export type CoderCommandId = (typeof CODER_COMMAND_IDS)[number];

const VALID_IDS: ReadonlySet<string> = new Set(CODER_COMMAND_IDS);

const COMMAND_INVOKED_EVENT = "command.invoked";

// `never[]` accepts any concrete handler shape (function-parameter contravariance).
type CommandHandler = (...args: never[]) => unknown;

/**
 * Single registration point for `coder.*` commands. Wraps every handler in
 * `TelemetryService.trace("command.invoked", ...)` so duration plus
 * success/error are captured uniformly. Input validation errors are reported
 * with a safe notification instead of VS Code's generic error notification.
 */
export class CommandManager implements vscode.Disposable {
	private readonly registrations = new Set<vscode.Disposable>();

	public constructor(
		private readonly telemetry: TelemetryService,
		private readonly logger: Logger,
	) {}

	public register(
		id: CoderCommandId,
		handler: CommandHandler,
	): vscode.Disposable {
		if (!VALID_IDS.has(id)) {
			throw new Error(`Unknown coder command id: ${id}`);
		}

		const invoke = handler as (...args: unknown[]) => unknown;
		const properties = { command_id: id };
		const wrapped = async (...args: unknown[]): Promise<unknown> => {
			try {
				return await this.telemetry.trace(
					COMMAND_INVOKED_EVENT,
					() => Promise.resolve(invoke(...args)),
					properties,
				);
			} catch (error) {
				if (!(error instanceof InputValidationError)) {
					throw error;
				}
				// Not awaited so the command settles without waiting on the user.
				void reportInputValidationError(error, this.logger);
				return undefined;
			}
		};

		let live: vscode.Disposable | null = vscode.commands.registerCommand(
			id,
			wrapped,
		);
		this.registrations.add(live);

		return {
			dispose: () => {
				if (!live) {
					return;
				}
				this.registrations.delete(live);
				live.dispose();
				live = null;
			},
		};
	}

	public dispose(): void {
		for (const inner of this.registrations) {
			inner.dispose();
		}
		this.registrations.clear();
	}
}
