import { logger } from "@repo/webview-shared/logger";
import { useRef, useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import type { Task } from "@repo/shared";

import type { ActionMenuItem } from "./ActionMenu";

export type TaskAction = "pausing" | "resuming" | "deleting" | null;

interface UseTaskMenuItemsOptions {
	task: Task;
	canPause?: boolean;
	canResume?: boolean;
	onDeleted?: () => void;
}

interface UseTaskMenuItemsResult {
	menuItems: ActionMenuItem[];
	action: TaskAction;
}

export function useTaskMenuItems({
	task,
	canPause = false,
	canResume = false,
	onDeleted,
}: UseTaskMenuItemsOptions): UseTaskMenuItemsResult {
	const api = useTasksApi();
	const [action, setAction] = useState<TaskAction>(null);
	const busyRef = useRef(false);

	const run = async (
		name: TaskAction,
		fn: () => Promise<void>,
		errorMsg: string,
	) => {
		if (busyRef.current) return;
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
					"Failed to pause task:",
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
					"Failed to resume task:",
				),
			loading: action === "resuming",
		});
	}

	menuItems.push({
		label: "View in Coder",
		icon: "link-external",
		onClick: () => void api.viewInCoder(task.id),
	});

	menuItems.push({
		label: "Download Logs",
		icon: "cloud-download",
		onClick: () => void api.downloadLogs(task.id),
	});

	menuItems.push({ separator: true });

	menuItems.push({
		label: "Delete",
		icon: "trash",
		onClick: () =>
			void run(
				"deleting",
				async () => {
					await api.deleteTask(task.id);
					onDeleted?.();
				},
				"Failed to delete task:",
			),
		danger: true,
		loading: action === "deleting",
	});

	return { menuItems, action };
}
