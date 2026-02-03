import type { Task, TaskDetails, TaskTemplate } from "@repo/shared";

/**
 * Compare two tasks by their key fields to determine if they've changed.
 * Returns true if tasks are equal (no update needed).
 */
export function tasksEqual(a: Task, b: Task): boolean {
	return (
		a.id === b.id &&
		a.status === b.status &&
		a.workspace_status === b.workspace_status &&
		a.current_state?.state === b.current_state?.state &&
		a.current_state?.message === b.current_state?.message &&
		a.display_name === b.display_name &&
		a.name === b.name
	);
}

/**
 * Compare two tasks, handling null/undefined.
 * Returns true if tasks are equal (no update needed).
 */
export function taskEqual(
	a: Task | null | undefined,
	b: Task | null | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return tasksEqual(a, b);
}

/**
 * Compare two task arrays to determine if they've changed.
 * Returns true if arrays are equal (no update needed).
 */
export function taskArraysEqual(a: Task[], b: Task[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((task, index) => tasksEqual(task, b[index]));
}

/**
 * Compare two TaskDetails objects to determine if they've changed.
 * Returns true if details are equal (no update needed).
 */
export function taskDetailsEqual(
	a: TaskDetails | null,
	b: TaskDetails | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;

	// Compare task fields
	if (!tasksEqual(a.task, b.task)) return false;

	// Compare action availability
	if (a.canPause !== b.canPause || a.canResume !== b.canResume) return false;

	// Compare logs status
	if (a.logsStatus !== b.logsStatus) return false;

	// Compare logs - check length, last log id, and last log content
	// Content must be checked because logs can be updated in place while streaming
	if (a.logs.length !== b.logs.length) return false;
	if (a.logs.length > 0 && b.logs.length > 0) {
		const lastA = a.logs[a.logs.length - 1];
		const lastB = b.logs[b.logs.length - 1];
		if (lastA.id !== lastB.id || lastA.content !== lastB.content) return false;
	}

	return true;
}

/**
 * Compare two template arrays to determine if they've changed.
 * Returns true if arrays are equal (no update needed).
 */
export function templateArraysEqual(
	a: TaskTemplate[],
	b: TaskTemplate[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every(
		(template, index) =>
			template.id === b[index].id &&
			template.activeVersionId === b[index].activeVersionId &&
			template.presets.length === b[index].presets.length,
	);
}
