import { getTaskUIState, type TaskDetails } from "@repo/webview-shared";

import { AgentChatHistory } from "./AgentChatHistory";
import { ErrorBanner } from "./ErrorBanner";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { TaskInput } from "./TaskInput";
import { useTaskMenuItems } from "./useTaskMenuItems";
import { getLoadingLabel } from "./utils";

interface TaskDetailViewProps {
	details: TaskDetails;
	onBack: () => void;
}

export function TaskDetailView({ details, onBack }: TaskDetailViewProps) {
	const { task, logs, logsStatus, canPause, canResume } = details;

	const uiState = getTaskUIState(task);
	const isThinking =
		uiState === "working" && task.workspace_agent_lifecycle === "ready";

	const { menuItems, isPausing, isResuming, isDeleting } = useTaskMenuItems({
		task,
		canPause,
		canResume,
		onDeleted: onBack,
	});

	const loadingAction = getLoadingLabel(isPausing, isResuming, isDeleting);

	return (
		<div className="task-detail-view">
			<TaskDetailHeader
				task={task}
				menuItems={menuItems}
				onBack={onBack}
				loadingAction={loadingAction}
			/>
			{uiState === "error" && <ErrorBanner task={task} />}
			<AgentChatHistory
				logs={logs}
				logsStatus={logsStatus}
				isThinking={isThinking}
			/>
			<TaskInput
				taskId={task.id}
				uiState={uiState}
				canPause={canPause}
				errorMessage={task.current_state?.message}
			/>
		</div>
	);
}
