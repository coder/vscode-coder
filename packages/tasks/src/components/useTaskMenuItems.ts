import { logger } from "@repo/webview-shared/logger";
import { useRef, useState } from "react";

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
	const [isPausing, setIsPausing] = useState(false);
	const [isResuming, setIsResuming] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	// Refs guard against double-clicks while an action is in-flight
	const isPausingRef = useRef(false);
	const isResumingRef = useRef(false);
	const isDeletingRef = useRef(false);

	const handlePause = async () => {
		if (isPausingRef.current) return;
		isPausingRef.current = true;
		setIsPausing(true);
		try {
			await api.pauseTask(task.id);
		} catch (err) {
			logger.error("Failed to pause task:", err);
		} finally {
			isPausingRef.current = false;
			setIsPausing(false);
		}
	};

	const handleResume = async () => {
		if (isResumingRef.current) return;
		isResumingRef.current = true;
		setIsResuming(true);
		try {
			await api.resumeTask(task.id);
		} catch (err) {
			logger.error("Failed to resume task:", err);
		} finally {
			isResumingRef.current = false;
			setIsResuming(false);
		}
	};

	const handleDelete = async () => {
		if (isDeletingRef.current) return;
		isDeletingRef.current = true;
		setIsDeleting(true);
		try {
			await api.deleteTask(task.id);
			onDeleted?.();
		} catch (err) {
			logger.error("Failed to delete task:", err);
		} finally {
			isDeletingRef.current = false;
			setIsDeleting(false);
		}
	};

	const menuItems: ActionMenuItem[] = [];

	if (canPause) {
		menuItems.push({
			label: "Pause Task",
			icon: "debug-pause",
			onClick: () => void handlePause(),
			loading: isPausing,
		});
	}

	if (canResume) {
		menuItems.push({
			label: "Resume Task",
			icon: "debug-start",
			onClick: () => void handleResume(),
			loading: isResuming,
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
		onClick: () => void handleDelete(),
		danger: true,
		loading: isDeleting,
	});

	const isLoading = isDeleting || isPausing || isResuming;

	return { menuItems, isDeleting, isPausing, isResuming, isLoading };
}
