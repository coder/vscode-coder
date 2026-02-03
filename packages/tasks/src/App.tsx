import { getState, setState } from "@repo/webview-shared";
import { useMessage } from "@repo/webview-shared/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeProgressRing } from "@vscode-elements/react-elements";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	CollapsibleSection,
	CreateTaskSection,
	ErrorState,
	NoTemplateState,
	NotSupportedState,
	TaskList,
} from "./components";
import { POLLING_CONFIG } from "./config";
import { useTasksApi } from "./hooks/useTasksApi";
import { taskArraysEqual, templateArraysEqual } from "./utils";

import type { IpcNotification, Task, TaskTemplate } from "@repo/shared";

interface PersistedState {
	tasks: Task[];
	templates: TaskTemplate[];
	createExpanded: boolean;
	historyExpanded: boolean;
	tasksSupported: boolean;
}

export default function App() {
	const api = useTasksApi();
	const queryClient = useQueryClient();

	const persistedState = useRef(getState<PersistedState>());
	const restored = persistedState.current;

	const [createExpanded, setCreateExpanded] = useState(
		restored?.createExpanded ?? true,
	);
	const [historyExpanded, setHistoryExpanded] = useState(
		restored?.historyExpanded ?? true,
	);

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

	const tasks = useMemo(() => [...(data?.tasks ?? [])], [data?.tasks]);
	const templates = useMemo(
		() => [...(data?.templates ?? [])],
		[data?.templates],
	);
	const tasksSupported = data?.tasksSupported ?? true;

	useEffect(() => {
		setState<PersistedState>({
			tasks,
			templates,
			createExpanded,
			historyExpanded,
			tasksSupported,
		});
	}, [tasks, templates, createExpanded, historyExpanded, tasksSupported]);

	const tasksRef = useRef<Task[]>(tasks);
	tasksRef.current = tasks;

	const templatesRef = useRef<TaskTemplate[]>(templates);
	templatesRef.current = templates;

	// Poll for task list updates
	useEffect(() => {
		if (!data) return;

		let cancelled = false;
		const pollInterval = setInterval(() => {
			api
				.getTasks()
				.then((updatedTasks) => {
					if (cancelled) return;
					if (!taskArraysEqual(tasksRef.current, updatedTasks)) {
						queryClient.setQueryData(["tasks-init"], (prev: typeof data) =>
							prev ? { ...prev, tasks: updatedTasks } : prev,
						);
					}
				})
				.catch(() => undefined);
		}, POLLING_CONFIG.TASK_LIST_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(pollInterval);
		};
	}, [api, data, queryClient]);

	useMessage<IpcNotification>((msg) => {
		switch (msg.type) {
			case "tasksUpdated":
				queryClient.setQueryData(["tasks-init"], (prev: typeof data) =>
					prev ? { ...prev, tasks: msg.data as Task[] } : prev,
				);
				break;

			case "taskUpdated": {
				const updatedTask = msg.data as Task;
				queryClient.setQueryData(["tasks-init"], (prev: typeof data) =>
					prev
						? {
								...prev,
								tasks: prev.tasks.map((t) =>
									t.id === updatedTask.id ? updatedTask : t,
								),
							}
						: prev,
				);
				break;
			}

			case "refresh": {
				api
					.getTasks()
					.then((updatedTasks) => {
						if (!taskArraysEqual(tasksRef.current, updatedTasks)) {
							queryClient.setQueryData(["tasks-init"], (prev: typeof data) =>
								prev ? { ...prev, tasks: updatedTasks } : prev,
							);
						}
					})
					.catch(() => undefined);
				api
					.getTemplates()
					.then((updatedTemplates) => {
						if (!templateArraysEqual(templatesRef.current, updatedTemplates)) {
							queryClient.setQueryData(["tasks-init"], (prev: typeof data) =>
								prev ? { ...prev, templates: updatedTemplates } : prev,
							);
						}
					})
					.catch(() => undefined);
				break;
			}

			case "showCreateForm":
				setCreateExpanded(true);
				break;

			case "logsAppend":
				// Task detail view will handle this in next PR
				break;
		}
	});

	const handleSelectTask = useCallback((_taskId: string) => {
		// Task detail view will be added in next PR
	}, []);

	if (isLoading) {
		return (
			<div className="loading-container">
				<VscodeProgressRing />
			</div>
		);
	}

	if (error && tasks.length === 0) {
		return (
			<ErrorState message={error.message} onRetry={() => void refetch()} />
		);
	}

	if (data && !tasksSupported) {
		return <NotSupportedState />;
	}

	if (data && templates.length === 0) {
		return <NoTemplateState />;
	}

	return (
		<div className="tasks-panel">
			<CollapsibleSection
				title="Create new task"
				expanded={createExpanded}
				onToggle={() => setCreateExpanded(!createExpanded)}
			>
				<CreateTaskSection templates={templates} />
			</CollapsibleSection>

			<CollapsibleSection
				title="Task History"
				expanded={historyExpanded}
				onToggle={() => setHistoryExpanded(!historyExpanded)}
			>
				<TaskList tasks={tasks} onSelectTask={handleSelectTask} />
			</CollapsibleSection>
		</div>
	);
}
