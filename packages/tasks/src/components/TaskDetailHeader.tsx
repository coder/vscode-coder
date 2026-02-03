import { getTaskLabel, type Task } from "@repo/shared";
import { VscodeIcon } from "@vscode-elements/react-elements";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { StatusIndicator } from "./StatusIndicator";

interface TaskDetailHeaderProps {
	task: Task;
	menuItems: ActionMenuItem[];
	onBack: () => void;
	loadingAction?: string | null;
}

export function TaskDetailHeader({
	task,
	menuItems,
	onBack,
	loadingAction,
}: TaskDetailHeaderProps) {
	const displayName = getTaskLabel(task);

	return (
		<div className="task-detail-header">
			<VscodeIcon
				actionIcon
				name="arrow-left"
				label="Back to task list"
				onClick={onBack}
			/>
			<StatusIndicator task={task} />
			<span className="task-detail-title" title={displayName}>
				{displayName}
				{loadingAction && (
					<span className="task-action-label">{loadingAction}</span>
				)}
			</span>
			<ActionMenu items={menuItems} />
		</div>
	);
}
