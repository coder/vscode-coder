import { useEffect, useState } from "react";

import { useTasksApi } from "./useTasksApi";

export function useWorkspaceLogs(): string[] {
	const { onWorkspaceLogsAppend, closeWorkspaceLogs } = useTasksApi();
	const [lines, setLines] = useState<string[]>([]);

	useEffect(() => {
		const unsubscribe = onWorkspaceLogsAppend((newLines) => {
			setLines((prev) => [...prev, ...newLines]);
		});
		return () => {
			unsubscribe();
			closeWorkspaceLogs();
		};
	}, [closeWorkspaceLogs, onWorkspaceLogsAppend]);

	return lines;
}
