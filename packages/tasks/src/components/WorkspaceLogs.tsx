import { isBuildingWorkspace, type Task } from "@repo/shared";

import { useWorkspaceLogs } from "../hooks/useWorkspaceLogs";

import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

function LogLine({ children }: { children: string }) {
	return <div className="log-entry">{children}</div>;
}

export function WorkspaceLogs({ task }: { task: Task }) {
	const lines = useWorkspaceLogs();
	const header = isBuildingWorkspace(task)
		? "Building workspace..."
		: "Running startup scripts...";

	return (
		<LogViewer header={header}>
			{lines.length === 0 ? (
				<LogViewerPlaceholder>Waiting for logs...</LogViewerPlaceholder>
			) : (
				lines.map((line, i) => <LogLine key={i}>{line}</LogLine>)
			)}
		</LogViewer>
	);
}
