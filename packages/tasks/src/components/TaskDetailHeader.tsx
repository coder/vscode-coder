import { getTaskLabel, type Task } from "@repo/shared";
import { VscodeIcon } from "@vscode-elements/react-elements";

import { getActionLabel } from "../utils/taskLoadingState";

import { ActionMenu } from "./ActionMenu";
import { StatusIndicator } from "./StatusIndicator";
import { useTaskMenuItems } from "./useTaskMenuItems";

interface TaskDetailHeaderProps {
	task: Task;
	onBack: () => void;
}

export function TaskDetailHeader({ task, onBack }: TaskDetailHeaderProps) {
	const label = getTaskLabel(task);
	const { menuItems, action } = useTaskMenuItems({ task });
	const loadingAction = getActionLabel(action);

	return (
		<div className="task-detail-header">
			<VscodeIcon
				actionIcon
				name="arrow-left"
				label="Back to task list"
				onClick={onBack}
			/>
			<StatusIndicator task={task} />
			<span className="task-detail-title" title={label}>
				{label}
				{loadingAction && (
					<span className="task-action-label">{loadingAction}</span>
				)}
			</span>
			<ActionMenu items={menuItems} />
		</div>
	);
}
