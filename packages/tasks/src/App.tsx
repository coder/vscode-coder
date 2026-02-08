import { TasksApi } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import {
	VscodeCollapsible,
	VscodeProgressRing,
	VscodeScrollable,
} from "@vscode-elements/react-elements";
import { useEffect, useRef } from "react";

import {
	CreateTaskSection,
	ErrorState,
	NoTemplateState,
	NotSupportedState,
	TaskList,
} from "./components";
import { useCollapsibleToggle } from "./hooks/useCollapsibleToggle";
import { useScrollableHeight } from "./hooks/useScrollableHeight";
import { useTasksData } from "./hooks/useTasksData";

type CollapsibleElement = React.ComponentRef<typeof VscodeCollapsible>;
type ScrollableElement = React.ComponentRef<typeof VscodeScrollable>;

export default function App() {
	const {
		tasks,
		templates,
		tasksSupported,
		isLoading,
		error,
		refetch,
		initialCreateExpanded,
		initialHistoryExpanded,
		persistUiState,
	} = useTasksData();

	const [createRef, createOpen, setCreateOpen] =
		useCollapsibleToggle<CollapsibleElement>(initialCreateExpanded);
	const [historyRef, historyOpen, _setHistoryOpen] =
		useCollapsibleToggle<CollapsibleElement>(initialHistoryExpanded);

	const createScrollRef = useRef<ScrollableElement>(null);
	const historyScrollRef = useRef<ScrollableElement>(null);
	useScrollableHeight(createRef, createScrollRef);
	useScrollableHeight(historyRef, historyScrollRef);

	const { onNotification } = useIpc();
	useEffect(() => {
		return onNotification(TasksApi.showCreateForm, () => setCreateOpen(true));
	}, [onNotification, setCreateOpen]);

	useEffect(() => {
		persistUiState({
			createExpanded: createOpen,
			historyExpanded: historyOpen,
		});
	}, [createOpen, historyOpen, persistUiState]);

	if (isLoading) {
		return (
			<div className="loading-container">
				<VscodeProgressRing />
			</div>
		);
	}

	if (error && tasks.length === 0) {
		return (
			<ErrorState message={error.message} onRetry={() => void refetch()} />
		);
	}

	if (!tasksSupported) {
		return <NotSupportedState />;
	}

	if (templates.length === 0) {
		return <NoTemplateState />;
	}

	return (
		<div className="tasks-panel">
			<VscodeCollapsible
				ref={createRef}
				heading="Create new task"
				open={createOpen}
			>
				<VscodeScrollable ref={createScrollRef}>
					<CreateTaskSection templates={templates} />
				</VscodeScrollable>
			</VscodeCollapsible>

			<VscodeCollapsible
				ref={historyRef}
				heading="Task History"
				open={historyOpen}
			>
				<VscodeScrollable ref={historyScrollRef}>
					<TaskList
						tasks={tasks}
						onSelectTask={(_taskId: string) => {
							// Task detail view will be added in next PR
						}}
					/>
				</VscodeScrollable>
			</VscodeCollapsible>
		</div>
	);
}
