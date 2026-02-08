import {
	TasksApi,
	type InitResponse,
	type Task,
	type TaskTemplate,
} from "@repo/shared";
import { getState, setState } from "@repo/webview-shared";
import { logger } from "@repo/webview-shared/logger";
import { useIpc } from "@repo/webview-shared/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { TASK_LIST_POLL_INTERVAL_MS } from "../config";
import { taskArraysEqual, templateArraysEqual } from "../utils";

import { useTasksApi } from "./useTasksApi";

interface PersistedState {
	tasks: Task[];
	templates: TaskTemplate[];
	createExpanded: boolean;
	historyExpanded: boolean;
	tasksSupported: boolean;
}

export function useTasksData() {
	const [restored] = useState(() => getState<PersistedState>());
	const api = useTasksApi();
	const { onNotification } = useIpc();
	const queryClient = useQueryClient();

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["tasks-init"],
		queryFn: () => api.init(),
		initialData: restored?.tasks?.length
			? {
					tasks: restored.tasks,
					templates: restored.templates,
					tasksSupported: restored.tasksSupported,
					baseUrl: "",
				}
			: undefined,
	});

	const tasks = data?.tasks ?? [];
	const templates = data?.templates ?? [];
	const tasksSupported = data?.tasksSupported ?? true;

	// Refs for reading current values inside async callbacks without stale closures
	const tasksRef = useRef<readonly Task[]>(tasks);
	const templatesRef = useRef<readonly TaskTemplate[]>(templates);
	useEffect(() => {
		tasksRef.current = tasks;
		templatesRef.current = templates;
	}, [tasks, templates]);

	function setTasks(updater: (tasks: readonly Task[]) => readonly Task[]) {
		queryClient.setQueryData<InitResponse>(
			["tasks-init"],
			(prev) => prev && { ...prev, tasks: updater(prev.tasks) },
		);
	}

	function setTemplates(newTemplates: readonly TaskTemplate[]) {
		queryClient.setQueryData<InitResponse>(
			["tasks-init"],
			(prev) => prev && { ...prev, templates: newTemplates },
		);
	}

	async function refreshTasks() {
		try {
			const updated = await api.getTasks();
			if (!taskArraysEqual(tasksRef.current, updated)) {
				setTasks(() => updated);
			}
		} catch (err) {
			logger.error("Failed to refresh tasks:", err);
		}
	}

	async function refreshTemplates() {
		try {
			const updated = await api.getTemplates();
			if (!templateArraysEqual(templatesRef.current, updated)) {
				setTemplates(updated);
			}
		} catch (err) {
			logger.error("Failed to refresh templates:", err);
		}
	}

	// Poll for task list updates
	const hasData = data !== undefined;
	useEffect(() => {
		if (!hasData) return;

		const pollInterval = setInterval(
			() => void refreshTasks(),
			TASK_LIST_POLL_INTERVAL_MS,
		);
		return () => clearInterval(pollInterval);
	}, [hasData, refreshTasks]);

	// Subscribe to push notifications
	useEffect(() => {
		const unsubs = [
			onNotification(TasksApi.tasksUpdated, (updatedTasks) => {
				setTasks(() => updatedTasks);
			}),

			onNotification(TasksApi.taskUpdated, (updatedTask) => {
				setTasks((prev) =>
					prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
				);
			}),

			onNotification(TasksApi.refresh, () => {
				void refreshTasks();
				void refreshTemplates();
			}),
		];

		return () => unsubs.forEach((fn) => fn());
	}, [onNotification, refreshTasks, refreshTemplates, setTasks]);

	function persistUiState(uiState: {
		createExpanded: boolean;
		historyExpanded: boolean;
	}) {
		setState<PersistedState>({
			tasks: [...tasks],
			templates: [...templates],
			tasksSupported,
			...uiState,
		});
	}

	return {
		tasks,
		templates,
		tasksSupported,
		isLoading,
		error,
		refetch,
		initialCreateExpanded: restored?.createExpanded ?? true,
		initialHistoryExpanded: restored?.historyExpanded ?? true,
		persistUiState,
	};
}
