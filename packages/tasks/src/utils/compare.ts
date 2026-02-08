import type { Task, TaskPreset, TaskTemplate } from "@repo/shared";

function presetsEqual(a: TaskPreset, b: TaskPreset): boolean {
	return a.id === b.id && a.name === b.name && a.isDefault === b.isDefault;
}

function tasksEqual(a: Task, b: Task): boolean {
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
 * Compare two task arrays to determine if they've changed.
 * Returns true if arrays are equal (no update needed).
 */
export function taskArraysEqual(
	a: readonly Task[],
	b: readonly Task[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every((task, index) => tasksEqual(task, b[index]));
}

/**
 * Compare two template arrays to determine if they've changed.
 * Returns true if arrays are equal (no update needed).
 */
export function templateArraysEqual(
	a: readonly TaskTemplate[],
	b: readonly TaskTemplate[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every(
		(template, index) =>
			template.id === b[index].id &&
			template.activeVersionId === b[index].activeVersionId &&
			template.presets.length === b[index].presets.length &&
			template.presets.every((p, i) => presetsEqual(p, b[index].presets[i])),
	);
}
