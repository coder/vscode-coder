import { useTasksApi } from "@repo/webview-shared/react";
import { VscodeProgressRing } from "@vscode-elements/react-elements";
import { useEffect, useState } from "react";

import type { Task, TaskTemplate } from "@repo/webview-shared";

export default function App() {
	const api = useTasksApi();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tasks, setTasks] = useState<Task[]>([]);
	const [templates, setTemplates] = useState<TaskTemplate[]>([]);
	const [tasksSupported, setTasksSupported] = useState(true);

	useEffect(() => {
		api
			.init()
			.then((data) => {
				setTasks(data.tasks);
				setTemplates(data.templates);
				setTasksSupported(data.tasksSupported);
				setLoading(false);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Failed to initialize");
				setLoading(false);
			});
	}, [api]);

	if (loading) {
		return (
			<div className="loading-container">
				<VscodeProgressRing />
			</div>
		);
	}

	if (error) {
		return (
			<div className="error-container">
				<p>Error: {error}</p>
			</div>
		);
	}

	if (!tasksSupported) {
		return (
			<div className="not-supported">
				<p>Tasks are not supported on this Coder server.</p>
			</div>
		);
	}

	return (
		<div className="tasks-panel">
			<h3>Tasks</h3>
			<p>Templates: {templates.length}</p>
			<p>Tasks: {tasks.length}</p>
		</div>
	);
}
