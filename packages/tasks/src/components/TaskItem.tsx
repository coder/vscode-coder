import { getTaskActions, type Task } from "@repo/shared";
import { VscodeProgressRing } from "@vscode-elements/react-elements";
import { useCallback } from "react";

import { ActionMenu } from "./ActionMenu";
import { StatusIndicator } from "./StatusIndicator";
import { useTaskMenuItems } from "./useTaskMenuItems";
import { getDisplayName, getLoadingLabel } from "./utils";

interface TaskItemProps {
	task: Task;
	onSelect: (taskId: string) => void;
}

export function TaskItem({ task, onSelect }: TaskItemProps) {
	const displayName = getDisplayName(task);
	const { canPause, canResume } = getTaskActions(task);

	const { menuItems, isLoading, isPausing, isResuming, isDeleting } =
		useTaskMenuItems({ task, canPause, canResume });

	const actionLabel = getLoadingLabel(isPausing, isResuming, isDeleting);
	const subtitle = task.current_state?.message || "No message available";

	const handleSelect = useCallback(() => {
		onSelect(task.id);
	}, [task.id, onSelect]);

	return (
		<div
			className={`task-item ${isLoading ? "task-item-loading" : ""}`}
			onClick={handleSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleSelect();
				}
			}}
		>
			<div className="task-item-status">
				{isLoading ? (
					<VscodeProgressRing className="task-item-spinner" />
				) : (
					<StatusIndicator
						status={task.status}
						state={task.current_state?.state}
						workspaceStatus={task.workspace_status}
					/>
				)}
			</div>
			<div className="task-item-content">
				<span className="task-title" title={displayName}>
					{displayName}
					{actionLabel && (
						<span className="task-action-label">{actionLabel}</span>
					)}
				</span>
				{subtitle && (
					<span className="task-subtitle" title={task.current_state?.message}>
						{subtitle}
					</span>
				)}
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
