import { ErrorState } from "./components/ErrorState";
import { NotSupportedState } from "./components/NotSupportedState";
import { TasksPanel } from "./components/TasksPanel";
import { usePersistedState } from "./hooks/usePersistedState";
import { useTasksQuery } from "./hooks/useTasksQuery";

export default function App() {
	const persisted = usePersistedState();
	const { tasksSupported, tasks, templates, refreshing, error, refetch } =
		useTasksQuery({
			initialTasks: persisted.initialTasks,
			initialTemplates: persisted.initialTemplates,
		});

	if (!tasksSupported) {
		return <NotSupportedState />;
	}

	if (error && tasks.length === 0) {
		return (
			<ErrorState message={error.message} onRetry={() => void refetch()} />
		);
	}

	return (
		<>
			{refreshing && <div className="refresh-bar" />}
			<TasksPanel tasks={tasks} templates={templates} persisted={persisted} />
		</>
	);
}
