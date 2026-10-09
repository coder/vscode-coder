export type TaskLoadingState =
	| "pausing"
	| "resuming"
	| "deleting"
	| "downloading"
	| null;

const ACTION_LABELS: Record<NonNullable<TaskLoadingState>, string> = {
	pausing: "Pausing...",
	resuming: "Resuming...",
	deleting: "Deleting...",
	downloading: "Downloading...",
};

export function getActionLabel(action: TaskLoadingState): string | null {
	return action ? ACTION_LABELS[action] : null;
}
