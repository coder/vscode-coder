import { type Task } from "@repo/shared";

interface StatusIndicatorProps {
	task: Task;
}

export function StatusIndicator({ task }: StatusIndicatorProps) {
	const title = task.status.charAt(0).toUpperCase() + task.status.slice(1);
	return <span className={`status-dot ${task.status}`} title={title} />;
}
