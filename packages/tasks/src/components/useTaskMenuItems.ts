import { getTaskPermissions, getTaskLabel, type Task } from "@repo/shared";
import { logger } from "@repo/webview-shared/logger";
import { useMutation } from "@tanstack/react-query";

import { useTasksApi } from "../hooks/useTasksApi";

import type { TaskLoadingState } from "../utils/taskLoadingState";

import type { ActionMenuItem } from "./ActionMenu";

interface UseTaskMenuItemsOptions {
	task: Task;
}

interface UseTaskMenuItemsResult {
	menuItems: ActionMenuItem[];
	action: TaskLoadingState;
}

export function useTaskMenuItems({
	task,
}: UseTaskMenuItemsOptions): UseTaskMenuItemsResult {
	const api = useTasksApi();
	const { canPause, canResume } = getTaskPermissions(task);
	const taskName = getTaskLabel(task);

	const mutation = useMutation({
		mutationFn: ({
			fn,
		}: {
			action: NonNullable<TaskLoadingState>;
			fn: () => Promise<void>;
		}) => fn(),
		onError: (err, { action }) =>
			logger.error(`Failed while ${action} task`, err),
	});

	const action: TaskLoadingState = mutation.isPending
		? mutation.variables.action
		: null;

	function run(
		actionName: NonNullable<TaskLoadingState>,
		fn: () => Promise<void>,
	) {
		if (!mutation.isPending) {
			mutation.mutate({ action: actionName, fn });
		}
	}

	const menuItems: ActionMenuItem[] = [];

	if (canPause) {
		menuItems.push({
			label: "Pause Task",
			icon: "debug-pause",
			onClick: () =>
				run("pausing", () => api.pauseTask({ taskId: task.id, taskName })),
			loading: action === "pausing",
		});
	}

	if (canResume) {
		menuItems.push({
			label: "Resume Task",
			icon: "debug-start",
			onClick: () =>
				run("resuming", () => api.resumeTask({ taskId: task.id, taskName })),
			loading: action === "resuming",
		});
	}

	menuItems.push({
		label: "View in Coder",
		icon: "link-external",
		onClick: () => api.viewInCoder(task.id),
	});

	menuItems.push({
		label: "Download Logs",
		icon: "cloud-download",
		onClick: () => run("downloading", () => api.downloadLogs(task.id)),
		loading: action === "downloading",
	});

	menuItems.push({ separator: true });

	menuItems.push({
		label: "Delete",
		icon: "trash",
		onClick: () =>
			run("deleting", () => api.deleteTask({ taskId: task.id, taskName })),
		danger: true,
		loading: action === "deleting",
	});

	return { menuItems, action };
}
