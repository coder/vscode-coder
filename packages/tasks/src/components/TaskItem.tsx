import { getTaskLabel, type Task } from "@repo/shared";
import { VscodeProgressRing } from "@vscode-elements/react-elements";

import { isActivate } from "../utils/keys";
import { getActionLabel } from "../utils/taskLoadingState";

import { ActionMenu } from "./ActionMenu";
import { StatusIndicator } from "./StatusIndicator";
import { useTaskMenuItems } from "./useTaskMenuItems";

interface TaskItemProps {
	task: Task;
	onSelect: (taskId: string) => void;
}

export function TaskItem({ task, onSelect }: TaskItemProps) {
	const { menuItems, action } = useTaskMenuItems({ task });

	const displayName = getTaskLabel(task);
	const subtitle = task.current_state?.message || "No message available";
	const handleSelect = () => onSelect(task.id);

	return (
		<div
			className={["task-item", action && "task-item-loading"]
				.filter(Boolean)
				.join(" ")}
			onClick={handleSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (isActivate(e)) {
					e.preventDefault();
					handleSelect();
				}
			}}
		>
			<div className="task-item-status">
				{action ? (
					<VscodeProgressRing className="task-item-spinner" />
				) : (
					<StatusIndicator task={task} />
				)}
			</div>
			<div className="task-item-content">
				<span className="task-title" title={displayName}>
					{displayName}
					{action && (
						<span className="task-action-label">{getActionLabel(action)}</span>
					)}
				</span>
				<span className="task-subtitle" title={subtitle}>
					{subtitle}
				</span>
			</div>
			<div
				className="task-item-menu"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<ActionMenu items={menuItems} />
			</div>
		</div>
	);
}
