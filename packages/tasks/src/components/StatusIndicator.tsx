import { getTaskUIState, type Task } from "@repo/shared";

interface StatusIndicatorProps {
	task: Task;
}

export function StatusIndicator({ task }: StatusIndicatorProps) {
	const uiState = getTaskUIState(task);
	const title = uiState.charAt(0).toUpperCase() + uiState.slice(1);

	return <span className={`status-dot ${uiState}`} title={title} />;
}
