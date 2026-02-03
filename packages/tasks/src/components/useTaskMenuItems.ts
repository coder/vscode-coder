import { useCallback, useMemo, useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import type { Task } from "@repo/shared";

import type { ActionMenuItem } from "./ActionMenu";

interface UseTaskMenuItemsOptions {
	task: Task;
	canPause?: boolean;
	canResume?: boolean;
	onDeleted?: () => void;
}

interface UseTaskMenuItemsResult {
	menuItems: ActionMenuItem[];
	isDeleting: boolean;
	isPausing: boolean;
	isResuming: boolean;
	isLoading: boolean;
}

export function useTaskMenuItems({
	task,
	canPause = false,
	canResume = false,
	onDeleted,
}: UseTaskMenuItemsOptions): UseTaskMenuItemsResult {
	const api = useTasksApi();
	const [isDeleting, setIsDeleting] = useState(false);
	const [isPausing, setIsPausing] = useState(false);
	const [isResuming, setIsResuming] = useState(false);

	const handlePause = useCallback(async () => {
		if (isPausing) return;
		setIsPausing(true);
		try {
			await api.pauseTask(task.id);
		} finally {
			setIsPausing(false);
		}
	}, [api, task.id, isPausing]);

	const handleResume = useCallback(async () => {
		if (isResuming) return;
		setIsResuming(true);
		try {
			await api.resumeTask(task.id);
		} finally {
			setIsResuming(false);
		}
	}, [api, task.id, isResuming]);

	const handleDelete = useCallback(async () => {
		if (isDeleting) return;
		setIsDeleting(true);
		try {
			await api.deleteTask(task.id);
			onDeleted?.();
		} finally {
			setIsDeleting(false);
		}
	}, [api, task.id, isDeleting, onDeleted]);

	const menuItems = useMemo<ActionMenuItem[]>(() => {
		const items: ActionMenuItem[] = [];

		if (canPause) {
			items.push({
				label: "Pause Task",
				icon: "debug-pause",
				onClick: () => void handlePause(),
				loading: isPausing,
			});
		}

		if (canResume) {
			items.push({
				label: "Resume Task",
				icon: "debug-start",
				onClick: () => void handleResume(),
				loading: isResuming,
			});
		}

		items.push({
			label: "View in Coder",
			icon: "link-external",
			onClick: () => void api.viewInCoder(task.id),
		});

		items.push({
			label: "Download Logs",
			icon: "cloud-download",
			onClick: () => void api.downloadLogs(task.id),
		});

		items.push({
			label: "Delete",
			icon: "trash",
			onClick: () => void handleDelete(),
			danger: true,
			loading: isDeleting,
		});

		return items;
	}, [
		api,
		canPause,
		canResume,
		handlePause,
		handleResume,
		handleDelete,
		isPausing,
		isResuming,
		isDeleting,
		task.id,
	]);

	const isLoading = isDeleting || isPausing || isResuming;

	return { menuItems, isDeleting, isPausing, isResuming, isLoading };
}
