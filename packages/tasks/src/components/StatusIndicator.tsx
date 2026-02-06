import { getTaskUIState, type Task, type TaskUIState } from "@repo/shared";

const UI_STATE_TO_CLASS: Record<TaskUIState, string> = {
	working: "running",
	idle: "ready",
	complete: "ready",
	error: "error",
	paused: "paused",
	initializing: "initializing",
};

const UI_STATE_TO_TITLE: Record<TaskUIState, string> = {
	working: "Running",
	idle: "Ready",
	complete: "Ready",
	error: "Error",
	paused: "Paused",
	initializing: "Initializing",
};

interface StatusIndicatorProps {
	task: Task;
}

export function StatusIndicator({ task }: StatusIndicatorProps) {
	const uiState = getTaskUIState(task);
	const className = UI_STATE_TO_CLASS[uiState];
	const title = UI_STATE_TO_TITLE[uiState];

	return <span className={`status-dot ${className}`} title={title} />;
}
