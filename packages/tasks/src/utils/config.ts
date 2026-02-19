export const TASK_LIST_POLL_INTERVAL_MS = 10_000;
export const TEMPLATE_POLL_INTERVAL_MS = 5 * 60 * 1_000;

// 5 seconds when task is actively working
export const TASK_ACTIVE_INTERVAL_MS = 5_000;
// 10 seconds when task is idle/complete/paused
export const TASK_IDLE_INTERVAL_MS = 10_000;

export const queryKeys = {
	all: ["tasks"],
	tasks: ["tasks", "list"],
	templates: ["tasks", "templates"],
	details: ["tasks", "detail"],
	taskDetail: (id: string) => ["tasks", "detail", id],
};
