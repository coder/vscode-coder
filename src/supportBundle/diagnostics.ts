import { type Logger } from "../logging/logger";

import { collectSupportLogFiles, type LogSources } from "./logFiles";
import { collectSettingsFile } from "./settings";

export type { LogSources } from "./logFiles";

export async function collectVsCodeDiagnostics(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = await collectSupportLogFiles(sources, logger);
	const settings = collectSettingsFile(logger);
	if (settings) {
		files.set("vscode-logs/settings.json", settings);
	}
	return files;
}
