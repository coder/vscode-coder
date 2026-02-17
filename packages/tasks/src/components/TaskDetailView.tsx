import { isTaskWorking, type TaskDetails } from "@repo/shared";

import { AgentChatHistory } from "./AgentChatHistory";
import { ErrorBanner } from "./ErrorBanner";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskMessageInput } from "./TaskMessageInput";

interface TaskDetailViewProps {
	details: TaskDetails;
	onBack: () => void;
}

export function TaskDetailView({ details, onBack }: TaskDetailViewProps) {
	const { task, logs, logsStatus } = details;

	const isThinking = isTaskWorking(task);

	return (
		<div className="task-detail-view">
			<TaskDetailHeader task={task} onBack={onBack} />
			{task.status === "error" && <ErrorBanner task={task} />}
			<AgentChatHistory
				logs={logs}
				logsStatus={logsStatus}
				isThinking={isThinking}
			/>
			<TaskMessageInput task={task} />
		</div>
	);
}
