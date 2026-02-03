import type { Task } from "@repo/shared";

export function getDisplayName(task: Task): string {
	return task.display_name || task.name || "Unnamed task";
}

export function getLoadingLabel(
	isPausing: boolean,
	isResuming: boolean,
	isDeleting: boolean,
): string | null {
	if (isPausing) return "Pausing...";
	if (isResuming) return "Resuming...";
	if (isDeleting) return "Deleting...";
	return null;
}
