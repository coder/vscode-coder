import type { WorkspaceConfiguration } from "vscode";

export const MEMORY_WARNING_THRESHOLD_SETTING =
	"coder.memoryMonitor.warningThreshold";
const DEFAULT_WARNING_THRESHOLD = 80;

/** The memory warning threshold in percent; `0` turns warnings off. */
export function getMemoryWarningThreshold(
	cfg: Pick<WorkspaceConfiguration, "get">,
): number {
	const value = cfg.get<number>(
		MEMORY_WARNING_THRESHOLD_SETTING,
		DEFAULT_WARNING_THRESHOLD,
	);
	return Number.isFinite(value)
		? Math.min(Math.max(value, 0), 99)
		: DEFAULT_WARNING_THRESHOLD;
}
