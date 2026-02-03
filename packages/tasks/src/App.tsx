import {
	getState,
	setState,
	type Task,
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
	TaskList,
} from "./components";
import { POLLING_CONFIG } from "./config";
import { taskArraysEqual, templateArraysEqual } from "./utils";

interface PersistedState {
	tasks: Task[];
	templates: TaskTemplate[];
	createExpanded: boolean;
	historyExpanded: boolean;
	tasksSupported: boolean;
}

export default function App() {
	const api = useTasksApi();

	const persistedState = useRef(getState<PersistedState>());
	const restored = persistedState.current;

	const [initialized, setInitialized] = useState(!!restored?.tasks?.length);
	const [tasks, setTasks] = useState<Task[]>(restored?.tasks ?? []);
	const [templates, setTemplates] = useState<TaskTemplate[]>(
		restored?.templates ?? [],
	);
	const [tasksSupported, setTasksSupported] = useState(
		restored?.tasksSupported ?? true,
	);

	const [createExpanded, setCreateExpanded] = useState(
		restored?.createExpanded ?? true,
	);
	const [historyExpanded, setHistoryExpanded] = useState(
		restored?.historyExpanded ?? true,
	);

	useEffect(() => {
		setState<PersistedState>({
			tasks,
			templates,
			createExpanded,
			historyExpanded,
			tasksSupported,
		});
	}, [tasks, templates, createExpanded, historyExpanded, tasksSupported]);

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

	const templatesRef = useRef<TaskTemplate[]>(templates);
	templatesRef.current = templates;

	// Poll for task list updates
	useEffect(() => {
		if (!initialized) return;

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
	}, [api, initialized]);

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
			case "tasksUpdated":
				setTasks(msg.data);
				break;

			case "taskUpdated": {
				const updatedTask = msg.data;
				setTasks((prev) =>
					prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
				);
				break;
			}

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
				<TaskList tasks={tasks} onSelectTask={handleSelectTask} />
			</CollapsibleSection>
		</div>
	);
}
