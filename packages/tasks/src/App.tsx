import {
	getState,
	setState,
	getTaskUIState,
	type Task,
	type TaskDetails,
	type TasksPushMessage,
	type TaskTemplate,
} from "@repo/webview-shared";
import { useMessage, useTasksApi } from "@repo/webview-shared/react";
import { VscodeProgressRing } from "@vscode-elements/react-elements";
import { useCallback, useEffect, useState, useRef } from "react";

import {
	CollapsibleSection,
	CreateTaskSection,
	ErrorState,
	NoTemplateState,
	NotSupportedState,
	TaskDetailView,
	TaskList,
} from "./components";
import { POLLING_CONFIG } from "./config";
import {
	taskArraysEqual,
	taskDetailsEqual,
	taskEqual,
	templateArraysEqual,
} from "./utils";

interface PersistedState {
	tasks: Task[];
	templates: TaskTemplate[];
	selectedTaskId: string | null;
	selectedTask: TaskDetails | null;
	createExpanded: boolean;
	historyExpanded: boolean;
	tasksSupported: boolean;
}

function validatePersistedState(
	state: PersistedState | undefined,
): PersistedState | undefined {
	if (!state) return undefined;

	if (state.selectedTask && state.tasks.length > 0) {
		const taskExists = state.tasks.some(
			(t) => t.id === state.selectedTask?.task.id,
		);
		if (!taskExists) {
			return { ...state, selectedTaskId: null, selectedTask: null };
		}
	}

	return state;
}

function isTaskActive(task: Task | null | undefined): boolean {
	if (!task) return false;
	const state = getTaskUIState(task);
	return state === "working" || state === "initializing";
}

export default function App() {
	const api = useTasksApi();

	const persistedState = useRef(
		validatePersistedState(getState<PersistedState>()),
	);
	const restored = persistedState.current;

	const [initialized, setInitialized] = useState(!!restored?.tasks?.length);
	const [tasks, setTasks] = useState<Task[]>(restored?.tasks ?? []);
	const [templates, setTemplates] = useState<TaskTemplate[]>(
		restored?.templates ?? [],
	);
	const [tasksSupported, setTasksSupported] = useState(
		restored?.tasksSupported ?? true,
	);

	const [selectedTask, setSelectedTask] = useState<TaskDetails | null>(
		restored?.selectedTask ?? null,
	);
	const [createExpanded, setCreateExpanded] = useState(
		restored?.createExpanded ?? true,
	);
	const [historyExpanded, setHistoryExpanded] = useState(
		restored?.historyExpanded ?? true,
	);
	const [isTransitioning, setIsTransitioning] = useState(false);

	useEffect(() => {
		setState<PersistedState>({
			tasks,
			templates,
			selectedTaskId: selectedTask?.task.id ?? null,
			selectedTask,
			createExpanded,
			historyExpanded,
			tasksSupported,
		});
	}, [
		tasks,
		templates,
		selectedTask,
		createExpanded,
		historyExpanded,
		tasksSupported,
	]);

	const [initLoading, setInitLoading] = useState(!restored?.tasks?.length);
	const [initError, setInitError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function initialize() {
			try {
				const data = await api.init();
				if (cancelled) return;

				setTasks(data.tasks);
				setTemplates(data.templates);
				setTasksSupported(data.tasksSupported);
				setInitialized(true);
				setInitError(null);

				if (selectedTaskRef.current) {
					const taskExists = data.tasks.some(
						(t) => t.id === selectedTaskRef.current?.task.id,
					);
					if (!taskExists) {
						expectedTaskIdRef.current = null;
						setSelectedTask(null);
					}
				}
			} catch (err) {
				if (cancelled) return;
				setInitError(
					err instanceof Error ? err.message : "Failed to initialize",
				);
			} finally {
				if (!cancelled) {
					setInitLoading(false);
				}
			}
		}

		void initialize();
		return () => {
			cancelled = true;
		};
	}, [api]);

	const tasksRef = useRef<Task[]>(tasks);
	tasksRef.current = tasks;

	const selectedTaskRef = useRef<TaskDetails | null>(selectedTask);
	selectedTaskRef.current = selectedTask;

	const templatesRef = useRef<TaskTemplate[]>(templates);
	templatesRef.current = templates;

	const expectedTaskIdRef = useRef<string | null>(
		restored?.selectedTaskId ?? null,
	);

	// Poll for task list updates when not viewing a specific task
	useEffect(() => {
		if (!initialized || selectedTask) return;

		let cancelled = false;
		const pollInterval = setInterval(() => {
			api
				.getTasks()
				.then((updatedTasks) => {
					if (cancelled) return;
					if (!taskArraysEqual(tasksRef.current, updatedTasks)) {
						setTasks(updatedTasks);
					}
				})
				.catch(() => undefined);
		}, POLLING_CONFIG.TASK_LIST_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(pollInterval);
		};
	}, [api, initialized, selectedTask]);

	const selectedTaskId = selectedTask?.task.id ?? null;
	const isActive = isTaskActive(selectedTask?.task);

	// Poll for selected task with adaptive interval based on task state
	useEffect(() => {
		if (!initialized || !selectedTaskId) return;

		let cancelled = false;
		const interval = isActive
			? POLLING_CONFIG.TASK_ACTIVE_INTERVAL_MS
			: POLLING_CONFIG.TASK_IDLE_INTERVAL_MS;

		const poll = () => {
			api
				.getTaskDetails(selectedTaskId)
				.then((details) => {
					if (cancelled || expectedTaskIdRef.current !== selectedTaskId) return;
					if (!taskDetailsEqual(selectedTaskRef.current, details)) {
						setSelectedTask(details);
					}
				})
				.catch(() => undefined);
		};

		const pollInterval = setInterval(poll, interval);
		return () => {
			cancelled = true;
			clearInterval(pollInterval);
		};
	}, [api, initialized, selectedTaskId, isActive]);

	const handleRetry = useCallback(() => {
		setInitLoading(true);
		setInitError(null);

		api
			.init()
			.then((data) => {
				setTasks(data.tasks);
				setTemplates(data.templates);
				setTasksSupported(data.tasksSupported);
				setInitialized(true);
			})
			.catch((err: unknown) => {
				setInitError(
					err instanceof Error ? err.message : "Failed to initialize",
				);
			})
			.finally(() => {
				setInitLoading(false);
			});
	}, [api]);

	useMessage<TasksPushMessage>((msg) => {
		switch (msg.type) {
			case "tasksUpdated": {
				setTasks(msg.data);
				const currentSelectedId = selectedTaskRef.current?.task.id;
				if (currentSelectedId) {
					const updatedTask = msg.data.find((t) => t.id === currentSelectedId);
					if (
						updatedTask &&
						!taskEqual(selectedTaskRef.current?.task, updatedTask)
					) {
						setSelectedTask((prev) =>
							prev ? { ...prev, task: updatedTask } : null,
						);
					}
				}
				break;
			}

			case "taskUpdated": {
				const updatedTask = msg.data;
				setTasks((prev) =>
					prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
				);
				if (selectedTaskRef.current?.task.id === updatedTask.id) {
					setSelectedTask((prev) =>
						prev ? { ...prev, task: updatedTask } : null,
					);
				}
				break;
			}

			case "logsAppend":
				if (selectedTaskRef.current) {
					setSelectedTask((prev) =>
						prev ? { ...prev, logs: [...prev.logs, ...msg.data] } : null,
					);
				}
				break;

			case "refresh": {
				api
					.getTasks()
					.then((updatedTasks) => {
						if (!taskArraysEqual(tasksRef.current, updatedTasks)) {
							setTasks(updatedTasks);
						}
					})
					.catch(() => undefined);
				api
					.getTemplates()
					.then((updatedTemplates) => {
						if (!templateArraysEqual(templatesRef.current, updatedTemplates)) {
							setTemplates(updatedTemplates);
						}
					})
					.catch(() => undefined);
				const taskIdAtRequest = selectedTaskRef.current?.task.id;
				if (taskIdAtRequest) {
					api
						.getTaskDetails(taskIdAtRequest)
						.then((details) => {
							if (expectedTaskIdRef.current !== taskIdAtRequest) return;
							if (!taskDetailsEqual(selectedTaskRef.current, details)) {
								setSelectedTask(details);
							}
						})
						.catch(() => undefined);
				}
				break;
			}

			case "showCreateForm":
				setSelectedTask(null);
				setCreateExpanded(true);
				break;
		}
	});

	const handleSelectTask = useCallback(
		(taskId: string) => {
			expectedTaskIdRef.current = taskId;
			setIsTransitioning(true);

			api
				.getTaskDetails(taskId)
				.then((details) => {
					if (expectedTaskIdRef.current === taskId) {
						setSelectedTask(details);
						setIsTransitioning(false);
					}
				})
				.catch(() => {
					if (expectedTaskIdRef.current === taskId) {
						setIsTransitioning(false);
					}
				});
		},
		[api],
	);

	const handleDeselectTask = useCallback(() => {
		expectedTaskIdRef.current = null;
		setSelectedTask(null);

		api
			.getTasks()
			.then((updatedTasks) => {
				if (!taskArraysEqual(tasksRef.current, updatedTasks)) {
					setTasks(updatedTasks);
				}
			})
			.catch(() => undefined);
	}, [api]);

	if (initLoading) {
		return (
			<div className="loading-container">
				<VscodeProgressRing />
			</div>
		);
	}

	if (initError && tasks.length === 0) {
		return <ErrorState message={initError} onRetry={handleRetry} />;
	}

	if (initialized && !tasksSupported) {
		return <NotSupportedState />;
	}

	if (initialized && templates.length === 0) {
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
				<div
					className={`task-history-content ${isTransitioning ? "transitioning" : ""}`}
				>
					{selectedTask ? (
						<TaskDetailView
							details={selectedTask}
							onBack={handleDeselectTask}
						/>
					) : (
						<TaskList tasks={tasks} onSelectTask={handleSelectTask} />
					)}
				</div>
			</CollapsibleSection>
		</div>
	);
}
