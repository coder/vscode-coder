import { TasksApi, type InitResponse } from "@repo/shared";
import { getState, setState } from "@repo/webview-shared";
import { useIpc } from "@repo/webview-shared/react";
import {
	VscodeCollapsible,
	VscodeProgressRing,
	VscodeScrollable,
} from "@vscode-elements/react-elements";
import { useEffect, useRef, useState } from "react";

import { CreateTaskSection } from "./components/CreateTaskSection";
import { ErrorState } from "./components/ErrorState";
import { NoTemplateState } from "./components/NoTemplateState";
import { NotSupportedState } from "./components/NotSupportedState";
import { TaskList } from "./components/TaskList";
import { useCollapsibleToggle } from "./hooks/useCollapsibleToggle";
import { useScrollableHeight } from "./hooks/useScrollableHeight";
import { useTasksQuery } from "./hooks/useTasksQuery";

interface PersistedState extends InitResponse {
	createExpanded: boolean;
	historyExpanded: boolean;
}

type CollapsibleElement = React.ComponentRef<typeof VscodeCollapsible>;
type ScrollableElement = React.ComponentRef<typeof VscodeScrollable>;

export default function App() {
	const [restored] = useState(() => getState<PersistedState>());
	const { tasks, templates, tasksSupported, data, isLoading, error, refetch } =
		useTasksQuery(restored);

	const [createRef, createOpen, setCreateOpen] =
		useCollapsibleToggle<CollapsibleElement>(restored?.createExpanded ?? true);
	const [historyRef, historyOpen] = useCollapsibleToggle<CollapsibleElement>(
		restored?.historyExpanded ?? true,
	);

	const createScrollRef = useRef<ScrollableElement>(null);
	const historyScrollRef = useRef<ScrollableElement>(null);
	useScrollableHeight(createRef, createScrollRef);
	useScrollableHeight(historyRef, historyScrollRef);

	const { onNotification } = useIpc();
	useEffect(() => {
		return onNotification(TasksApi.showCreateForm, () => setCreateOpen(true));
	}, [onNotification, setCreateOpen]);

	useEffect(() => {
		if (data) {
			setState<PersistedState>({
				...data,
				createExpanded: createOpen,
				historyExpanded: historyOpen,
			});
		}
	}, [data, createOpen, historyOpen]);

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
