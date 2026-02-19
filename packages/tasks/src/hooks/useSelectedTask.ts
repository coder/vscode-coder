import { isStableTask, type Task, type TaskDetails } from "@repo/shared";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
	TASK_ACTIVE_INTERVAL_MS,
	TASK_IDLE_INTERVAL_MS,
} from "../utils/config";

import { useTasksApi } from "./useTasksApi";

const QUERY_KEY = "task-details";

export function useSelectedTask(tasks: readonly Task[]) {
	const api = useTasksApi();
	const queryClient = useQueryClient();
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

	// Auto-deselect when the selected task disappears from the list
	// (React "adjusting state during render" pattern)
	if (
		selectedTaskId &&
		tasks.length > 0 &&
		!tasks.some((t) => t.id === selectedTaskId)
	) {
		setSelectedTaskId(null);
	}

	const { data: selectedTask, isLoading: isLoadingDetails } = useQuery({
		queryKey: [QUERY_KEY, selectedTaskId],
		queryFn: selectedTaskId
			? () => api.getTaskDetails(selectedTaskId)
			: skipToken,
		refetchInterval: (query) => {
			const task = query.state.data?.task;
			return task && isStableTask(task)
				? TASK_IDLE_INTERVAL_MS
				: TASK_ACTIVE_INTERVAL_MS;
		},
	});

	// Keep selected task in sync with push updates between polls
	useEffect(() => {
		return api.onTaskUpdated((updatedTask) => {
			if (updatedTask.id !== selectedTaskId) return;
			queryClient.setQueryData<TaskDetails>(
				[QUERY_KEY, selectedTaskId],
				(prev) => (prev ? { ...prev, task: updatedTask } : undefined),
			);
		});
	}, [api.onTaskUpdated, selectedTaskId, queryClient]);

	const deselectTask = () => {
		setSelectedTaskId(null);
		queryClient.removeQueries({ queryKey: [QUERY_KEY] });
	};

	return {
		selectedTask: selectedTask ?? null,
		isLoadingDetails,
		selectTask: setSelectedTaskId,
		deselectTask,
	};
}
