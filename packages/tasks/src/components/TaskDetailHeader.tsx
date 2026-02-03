import { VscodeIcon } from "@vscode-elements/react-elements";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { StatusIndicator } from "./StatusIndicator";
import { getDisplayName } from "./utils";

import type { Task } from "@repo/webview-shared";

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
	const displayName = getDisplayName(task);

	return (
		<div className="task-detail-header">
			<VscodeIcon
				actionIcon
				name="arrow-left"
				label="Back to task list"
				onClick={onBack}
			/>
			<StatusIndicator
				status={task.status}
				state={task.current_state?.state}
				workspaceStatus={task.workspace_status}
			/>
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
