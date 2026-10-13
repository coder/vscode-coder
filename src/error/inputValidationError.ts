import { vscodeProposed } from "../vscode/proposed";

import type { InputValidationError } from "../common/validation";
import type { Logger } from "../logging/logger";

export const OPEN_CODER_OUTPUT_ACTION = "Open Coder Output";

/**
 * Logs the bounded diagnostic value and shows only the safe validation
 * message, offering to open the Coder output. A title shows a modal dialog
 * with the message as its detail.
 */
export async function reportInputValidationError(
	error: InputValidationError,
	logger: Logger,
	modalTitle?: string,
): Promise<void> {
	logger.warn(error.message, { value: error.diagnosticValue });
	const action = modalTitle
		? await vscodeProposed.window.showErrorMessage(
				modalTitle,
				{ modal: true, useCustom: true, detail: error.message },
				OPEN_CODER_OUTPUT_ACTION,
			)
		: await vscodeProposed.window.showErrorMessage(
				error.message,
				OPEN_CODER_OUTPUT_ACTION,
			);
	if (action === OPEN_CODER_OUTPUT_ACTION) {
		logger.show();
	}
}
