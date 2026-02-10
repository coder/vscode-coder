import { getTaskActions, getTaskLabel, type Task } from "@repo/shared";
import { logger } from "@repo/webview-shared/logger";
import { useMutation } from "@tanstack/react-query";

import { useTasksApi } from "../hooks/useTasksApi";

import type { ActionMenuItem } from "./ActionMenu";

export type TaskAction =
	| "pausing"
	| "resuming"
	| "deleting"
	| "downloading"
	| null;

interface ActionRequest {
	action: NonNullable<TaskAction>;
	fn: () => Promise<void>;
}

interface UseTaskMenuItemsOptions {
	task: Task;
}

interface UseTaskMenuItemsResult {
	menuItems: ActionMenuItem[];
	action: TaskAction;
}

export function useTaskMenuItems({
	task,
}: UseTaskMenuItemsOptions): UseTaskMenuItemsResult {
	const api = useTasksApi();
	const { canPause, canResume } = getTaskActions(task);

	const { mutate, isPending, variables } = useMutation({
		mutationFn: (req: ActionRequest) => req.fn(),
		onError: (err, { action }) =>
			logger.error(`Failed while ${action} task`, err),
	});

	const action: TaskAction = isPending ? (variables?.action ?? null) : null;

	const taskName = getTaskLabel(task);
	const menuItems: ActionMenuItem[] = [];

	if (canPause) {
		menuItems.push({
			label: "Pause Task",
			icon: "debug-pause",
			onClick: () => {
				if (!isPending) {
					mutate({
						action: "pausing",
						fn: () => api.pauseTask({ taskId: task.id, taskName }),
					});
				}
			},
			loading: action === "pausing",
		});
	}

	if (canResume) {
		menuItems.push({
			label: "Resume Task",
			icon: "debug-start",
			onClick: () => {
				if (!isPending) {
					mutate({
						action: "resuming",
						fn: () => api.resumeTask({ taskId: task.id, taskName }),
					});
				}
			},
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
		onClick: () => {
			if (!isPending) {
				mutate({
					action: "downloading",
					fn: () => api.downloadLogs(task.id),
				});
			}
		},
		loading: action === "downloading",
	});

	menuItems.push({ separator: true });

	menuItems.push({
		label: "Delete",
		icon: "trash",
		onClick: () => {
			if (!isPending) {
				mutate({
					action: "deleting",
					fn: () => api.deleteTask({ taskId: task.id, taskName }),
				});
			}
		},
		danger: true,
		loading: action === "deleting",
	});

	return { menuItems, action };
}
