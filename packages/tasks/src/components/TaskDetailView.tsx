import { getTaskActions, type TaskDetails } from "@repo/shared";

import { getActionLabel } from "../utils/taskAction";

import { AgentChatHistory } from "./AgentChatHistory";
import { ErrorBanner } from "./ErrorBanner";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskInput } from "./TaskInput";
import { useTaskMenuItems } from "./useTaskMenuItems";

interface TaskDetailViewProps {
	details: TaskDetails;
	onBack: () => void;
}

export function TaskDetailView({ details, onBack }: TaskDetailViewProps) {
	const { task, logs, logsStatus } = details;
	const { canPause } = getTaskActions(task);

	const isWorking =
		task.status === "active" &&
		task.current_state?.state === "working" &&
		task.workspace_agent_lifecycle === "ready";

	const { menuItems, action } = useTaskMenuItems({ task });

	return (
		<div className="task-detail-view">
			<TaskDetailHeader
				task={task}
				menuItems={menuItems}
				onBack={onBack}
				loadingAction={getActionLabel(action)}
			/>
			{task.status === "error" && <ErrorBanner task={task} />}
			<AgentChatHistory
				logs={logs}
				logsStatus={logsStatus}
				isThinking={isWorking}
			/>
			<TaskInput taskId={task.id} task={task} canPause={canPause} />
		</div>
	);
}
