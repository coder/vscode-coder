export const POLLING_CONFIG = {
	// Task list polling (background, only when not viewing a task)
	TASK_LIST_INTERVAL_MS: 10000, // 10 seconds

	// Selected task polling - adaptive based on task state
	TASK_ACTIVE_INTERVAL_MS: 5000, // 5 seconds when task is actively working
	TASK_IDLE_INTERVAL_MS: 10000, // 10 seconds when task is idle/complete/paused
} as const;
