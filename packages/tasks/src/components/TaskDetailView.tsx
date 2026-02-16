import {
	isWorkspaceStarting,
	isTaskWorking,
	type TaskDetails,
} from "@repo/shared";

import { useWorkspaceLogs } from "../hooks/useWorkspaceLogs";

import { AgentChatHistory } from "./AgentChatHistory";
import { ErrorBanner } from "./ErrorBanner";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskMessageInput } from "./TaskMessageInput";
import { WorkspaceLogs } from "./WorkspaceLogs";

interface TaskDetailViewProps {
	details: TaskDetails;
	onBack: () => void;
}

export function TaskDetailView({ details, onBack }: TaskDetailViewProps) {
	const { task, logs, logsStatus } = details;

	const starting = isWorkspaceStarting(task);
	const workspaceLines = useWorkspaceLogs(starting);
	const isThinking = isTaskWorking(task);

	return (
		<div className="task-detail-view">
			<TaskDetailHeader task={task} onBack={onBack} />
			{task.status === "error" && <ErrorBanner task={task} />}
			{starting ? (
				<WorkspaceLogs task={task} lines={workspaceLines} />
			) : (
				<AgentChatHistory
					logs={logs}
					logsStatus={logsStatus}
					isThinking={isThinking}
				/>
			)}
			<TaskMessageInput task={task} />
		</div>
	);
}
