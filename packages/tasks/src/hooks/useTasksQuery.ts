import { type InitResponse, type Task } from "@repo/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { TASK_LIST_POLL_INTERVAL_MS } from "../utils/config";

import { useTasksApi } from "./useTasksApi";

const QUERY_KEY = ["tasks-init"] as const;

export function useTasksQuery(initialData?: InitResponse) {
	const api = useTasksApi();
	const queryClient = useQueryClient();

	function updateTasks(updater: (tasks: readonly Task[]) => readonly Task[]) {
		queryClient.setQueryData<InitResponse>(
			QUERY_KEY,
			(prev) => prev && { ...prev, tasks: updater(prev.tasks) },
		);
	}

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: QUERY_KEY,
		queryFn: () => api.init(),
		refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
		initialData,
	});

	const tasks = data?.tasks ?? [];
	const templates = data?.templates ?? [];
	const tasksSupported = data?.tasksSupported ?? true;

	// Subscribe to push notifications
	useEffect(() => {
		const unsubs = [
			api.onTasksUpdated((updatedTasks) => {
				updateTasks(() => updatedTasks);
			}),

			api.onTaskUpdated((updatedTask) => {
				updateTasks((tasks) =>
					tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
				);
			}),

			api.onRefresh(() => {
				void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			}),
		];

		return () => unsubs.forEach((fn) => fn());
	}, [api.onTasksUpdated, api.onTaskUpdated, api.onRefresh, queryClient]);

	return { tasks, templates, tasksSupported, data, isLoading, error, refetch };
}
