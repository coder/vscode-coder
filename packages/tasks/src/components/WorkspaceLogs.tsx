import { isBuildingWorkspace, type Task } from "@repo/shared";

import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

export function WorkspaceLogs({
	task,
	lines,
}: {
	task: Task;
	lines: string[];
}) {
	const header = isBuildingWorkspace(task)
		? "Building workspace..."
		: "Running startup scripts...";

	return (
		<LogViewer header={header}>
			{lines.length === 0 ? (
				<LogViewerPlaceholder>Waiting for logs...</LogViewerPlaceholder>
			) : (
				lines.map((line, i) => (
					<div key={i} className="log-entry">
						{line}
					</div>
				))
			)}
		</LogViewer>
	);
}
