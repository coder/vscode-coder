import { TasksApi } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useEffect, useState } from "react";

export function useWorkspaceLogs(active: boolean): string[] {
	const { command, onNotification } = useIpc();
	const [lines, setLines] = useState<string[]>([]);
	const [prevActive, setPrevActive] = useState(active);

	// Reset lines when active flag changes (React "adjusting state during render" pattern)
	if (active !== prevActive) {
		setPrevActive(active);
		setLines([]);
	}

	useEffect(() => {
		if (!active) return;
		const unsubscribe = onNotification(
			TasksApi.workspaceLogsAppend,
			(newLines) => {
				setLines((prev) => [...prev, ...newLines]);
			},
		);
		return () => {
			unsubscribe();
			command(TasksApi.closeWorkspaceLogs);
		};
	}, [active, command, onNotification]);

	return lines;
}
