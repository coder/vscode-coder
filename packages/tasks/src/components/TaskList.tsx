import { TaskItem } from "./TaskItem";

import type { Task } from "@repo/shared";

interface TaskListProps {
	tasks: readonly Task[];
	onSelectTask: (taskId: string) => void;
}

export function TaskList({ tasks, onSelectTask }: TaskListProps) {
	if (tasks.length === 0) {
		return <div className="empty-task-list">No tasks yet</div>;
	}

	return (
		<div className="task-list">
			{tasks.map((task) => (
				<TaskItem key={task.id} task={task} onSelect={onSelectTask} />
			))}
		</div>
	);
}
