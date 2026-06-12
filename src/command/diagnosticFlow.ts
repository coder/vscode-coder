import * as vscode from "vscode";
import { ZodError } from "zod";

import { toError } from "../error/errorUtils";
import { withCancellableProgress, type ProgressContext } from "../progress";

import type { DiagnosticTrace } from "../instrumentation/diagnostics";
import type { Logger } from "../logging/logger";

export interface DiagnosticCliOptions {
	telemetry: DiagnosticTrace;
	logger: Logger;
	/** Display name used in messages, e.g. "Speed test". */
	name: string;
	progressTitle: string;
	/** Invoke the CLI under the progress notification; resolves to raw JSON. */
	exec: (ctx: ProgressContext) => Promise<string>;
	/** Parse the output, record success telemetry, and show the results. */
	display: (rawJson: string) => void;
}

/**
 * Shared tail of the CLI diagnostic commands: runs the CLI under a
 * cancellable progress notification, then parses and displays its output,
 * mapping cancellation, CLI failures, and parse failures to telemetry and
 * user-facing error messages.
 */
export async function runDiagnosticCli(
	options: DiagnosticCliOptions,
): Promise<void> {
	const { telemetry, logger, name } = options;
	const result = await withCancellableProgress(options.exec, {
		location: vscode.ProgressLocation.Notification,
		title: options.progressTitle,
		cancellable: true,
	});

	if (!result.ok) {
		if (result.cancelled) {
			telemetry.abort("progress");
			return;
		}
		telemetry.error();
		logger.error(`${name} failed`, result.error);
		vscode.window.showErrorMessage(
			`${name} failed: ${toError(result.error).message}`,
		);
		return;
	}

	try {
		options.display(result.value);
	} catch (err) {
		if (err instanceof ZodError || err instanceof SyntaxError) {
			telemetry.error("parse_error");
			logger.error(`Failed to parse ${name} output`, err);
			vscode.window.showErrorMessage(
				`${name} output did not match the expected format. Check \`Output > Coder\` for details.`,
			);
			return;
		}
		telemetry.error();
		logger.error(`Failed to display ${name} results`, err);
		vscode.window.showErrorMessage(
			`${name} returned unexpected output: ${toError(err).message}`,
		);
	}
}
