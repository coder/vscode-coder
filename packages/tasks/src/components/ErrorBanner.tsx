import { VscodeIcon } from "@vscode-elements/react-elements";
import { useCallback } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import type { Task } from "@repo/shared";

interface ErrorBannerProps {
	task: Task;
}

export function ErrorBanner({ task }: ErrorBannerProps) {
	const api = useTasksApi();
	const message = task.current_state?.message || "Build failed";

	const handleViewLogs = useCallback(() => {
		void api.viewLogs(task.id);
	}, [api, task.id]);

	return (
		<div className="error-banner">
			<VscodeIcon name="warning" />
			<span className="error-banner-message">{message}.</span>
			<button type="button" className="text-link" onClick={handleViewLogs}>
				View logs <VscodeIcon name="link-external" />
			</button>
		</div>
	);
}
