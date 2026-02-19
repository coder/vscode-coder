import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
	TASK_LIST_POLL_INTERVAL_MS,
	TEMPLATE_POLL_INTERVAL_MS,
	queryKeys,
} from "../utils/config";

import { useTasksApi } from "./useTasksApi";

import type { Task, TaskTemplate } from "@repo/shared";

interface UseTasksQueryOptions {
	initialTasks?: readonly Task[] | null;
	initialTemplates?: readonly TaskTemplate[] | null;
}

export function useTasksQuery(options?: UseTasksQueryOptions) {
	const api = useTasksApi();
	const queryClient = useQueryClient();

	const hasInitialData =
		options?.initialTasks !== undefined ||
		options?.initialTemplates !== undefined;

	const [refreshing, setRefreshing] = useState(hasInitialData);

	const refreshAll = () =>
		queryClient
			.invalidateQueries({ queryKey: queryKeys.all })
			.finally(() => setRefreshing(false));

	const tasksQuery = useQuery({
		queryKey: queryKeys.tasks,
		queryFn: () => api.getTasks(),
		refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
		initialData: options?.initialTasks,
	});

	const templatesQuery = useQuery({
		queryKey: queryKeys.templates,
		queryFn: () => api.getTemplates(),
		refetchInterval: TEMPLATE_POLL_INTERVAL_MS,
		staleTime: TEMPLATE_POLL_INTERVAL_MS,
		initialData: options?.initialTemplates,
	});

	useEffect(() => {
		const unsubs = [
			api.onTasksUpdated((tasks) =>
				queryClient.setQueryData(queryKeys.tasks, () => tasks),
			),
			api.onTaskUpdated((updated) =>
				queryClient.setQueryData<readonly Task[] | null>(
					queryKeys.tasks,
					(prev) =>
						prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev,
				),
			),
			api.onRefresh(() => {
				setRefreshing(true);
				void refreshAll();
			}),
		];
		return () => unsubs.forEach((fn) => fn());
	}, [api, queryClient]);

	useEffect(() => {
		if (hasInitialData) void refreshAll();
	}, []);

	return {
		tasksSupported: tasksQuery.data !== null && templatesQuery.data !== null,
		tasks: tasksQuery.data ?? [],
		templates: templatesQuery.data ?? [],
		refreshing: refreshing || tasksQuery.isLoading || templatesQuery.isLoading,
		error: tasksQuery.error,
		refetch: tasksQuery.refetch,
	};
}
