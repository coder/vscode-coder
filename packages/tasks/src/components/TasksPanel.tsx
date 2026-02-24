import {
	VscodeCollapsible,
	VscodeProgressRing,
	VscodeScrollable,
} from "@vscode-elements/react-elements";
import { useEffect, useRef } from "react";

import { useCollapsibleToggle } from "../hooks/useCollapsibleToggle";
import { useScrollableHeight } from "../hooks/useScrollableHeight";
import { useSelectedTask } from "../hooks/useSelectedTask";
import { useTasksApi } from "../hooks/useTasksApi";

import { CreateTaskSection } from "./CreateTaskSection";
import { NoTemplateState } from "./NoTemplateState";
import { TaskDetailView } from "./TaskDetailView";
import { TaskList } from "./TaskList";

import type { Task, TaskTemplate } from "@repo/shared";

import type { PersistedState } from "../hooks/usePersistedState";

type CollapsibleElement = React.ComponentRef<typeof VscodeCollapsible>;
type ScrollableElement = React.ComponentRef<typeof VscodeScrollable>;

interface TasksPanelProps {
	tasks: readonly Task[];
	templates: readonly TaskTemplate[];
	persisted: {
		initialCreateExpanded: boolean;
		initialHistoryExpanded: boolean;
		save: (state: PersistedState) => void;
	};
}

export function TasksPanel({
	tasks,
	templates,
	persisted: { initialCreateExpanded, initialHistoryExpanded, save },
}: TasksPanelProps) {
	const { selectedTask, isLoadingDetails, selectTask, deselectTask } =
		useSelectedTask(tasks);

	const [createRef, createOpen, setCreateOpen] =
		useCollapsibleToggle<CollapsibleElement>(initialCreateExpanded);
	const [historyRef, historyOpen] = useCollapsibleToggle<CollapsibleElement>(
		initialHistoryExpanded,
	);

	const createScrollRef = useRef<ScrollableElement>(null);
	const historyScrollRef = useRef<HTMLDivElement>(null);
	useScrollableHeight(createRef, createScrollRef);
	useScrollableHeight(historyRef, historyScrollRef);

	const { onShowCreateForm } = useTasksApi();
	useEffect(() => {
		return onShowCreateForm(() => setCreateOpen(true));
	}, [onShowCreateForm, setCreateOpen]);

	useEffect(() => {
		save({
			tasks,
			templates,
			createExpanded: createOpen,
			historyExpanded: historyOpen,
		});
	}, [save, tasks, templates, createOpen, historyOpen]);

	function renderHistory() {
		if (selectedTask) {
			return <TaskDetailView details={selectedTask} onBack={deselectTask} />;
		}
		if (isLoadingDetails) {
			return (
				<div className="loading-container">
					<VscodeProgressRing />
				</div>
			);
		}
		return <TaskList tasks={tasks} onSelectTask={selectTask} />;
	}

	return (
		<div className="tasks-panel">
			<VscodeCollapsible
				ref={createRef}
				heading="Create new task"
				open={createOpen}
			>
				<VscodeScrollable ref={createScrollRef}>
					{templates.length === 0 ? (
						<NoTemplateState />
					) : (
						<CreateTaskSection templates={templates} />
					)}
				</VscodeScrollable>
			</VscodeCollapsible>

			<VscodeCollapsible
				ref={historyRef}
				heading="Task History"
				open={historyOpen}
			>
				<div ref={historyScrollRef} className="collapsible-content">
					{renderHistory()}
				</div>
			</VscodeCollapsible>
		</div>
	);
}
