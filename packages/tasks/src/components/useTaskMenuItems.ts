import { getTaskActions, type Task } from "@repo/shared";
import { logger } from "@repo/webview-shared/logger";
import { useRef, useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import type { ActionMenuItem } from "./ActionMenu";

export type TaskAction = "pausing" | "resuming" | "deleting" | null;

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
	const [action, setAction] = useState<TaskAction>(null);
	const busyRef = useRef(false);

	const run = async (
		name: TaskAction,
		fn: () => Promise<void>,
		errorMsg: string,
	) => {
		if (busyRef.current) {
			return;
		}
		busyRef.current = true;
		setAction(name);
		try {
			await fn();
		} catch (err) {
			logger.error(errorMsg, err);
		} finally {
			busyRef.current = false;
			setAction(null);
		}
	};

	const menuItems: ActionMenuItem[] = [];

	if (canPause) {
		menuItems.push({
			label: "Pause Task",
			icon: "debug-pause",
			onClick: () =>
				void run(
					"pausing",
					() => api.pauseTask(task.id),
					"Failed to pause task",
				),
			loading: action === "pausing",
		});
	}

	if (canResume) {
		menuItems.push({
			label: "Resume Task",
			icon: "debug-start",
			onClick: () =>
				void run(
					"resuming",
					() => api.resumeTask(task.id),
					"Failed to resume task",
				),
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
		onClick: () => api.downloadLogs(task.id),
	});

	menuItems.push({ separator: true });

	menuItems.push({
		label: "Delete",
		icon: "trash",
		onClick: () =>
			void run(
				"deleting",
				() => api.deleteTask(task.id),
				"Failed to delete task",
			),
		danger: true,
		loading: action === "deleting",
	});

	return { menuItems, action };
}
