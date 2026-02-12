import { AgentChatHistory } from "./AgentChatHistory";
import { ErrorBanner } from "./ErrorBanner";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskMessageInput } from "./TaskMessageInput";

import type { TaskDetails } from "@repo/shared";

interface TaskDetailViewProps {
	details: TaskDetails;
	onBack: () => void;
}

export function TaskDetailView({ details, onBack }: TaskDetailViewProps) {
	const { task, logs, logsStatus } = details;

	const isThinking =
		task.status === "active" && task.current_state?.state === "working";

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
