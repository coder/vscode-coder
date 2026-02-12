import { VscodeIcon } from "@vscode-elements/react-elements";

import { useTasksApi } from "../hooks/useTasksApi";

import type { Task } from "@repo/shared";

interface ErrorBannerProps {
	task: Task;
}

export function ErrorBanner({ task }: ErrorBannerProps) {
	const api = useTasksApi();
	const message = task.current_state?.message || "Task failed";

	return (
		<div className="error-banner">
			<VscodeIcon name="warning" />
			<span>{message}</span>
			<button
				type="button"
				className="text-link"
				onClick={() => api.viewLogs(task.id)}
			>
				View logs <VscodeIcon name="link-external" />
			</button>
		</div>
	);
}
