import { useEffect, useState } from "react";

import { useTasksApi } from "./useTasksApi";

/**
 * Subscribes to workspace log lines pushed from the extension.
 * Batches updates per animation frame to avoid excessive re-renders
 * when many lines arrive in quick succession.
 */
export function useWorkspaceLogs(): string[] {
	const { onWorkspaceLogsAppend, closeWorkspaceLogs } = useTasksApi();
	const [lines, setLines] = useState<string[]>([]);

	useEffect(() => {
		let pending: string[] = [];
		let frame = 0;

		const unsubscribe = onWorkspaceLogsAppend((newLines) => {
			pending.push(...newLines);
			if (frame === 0) {
				frame = requestAnimationFrame(() => {
					const batch = pending;
					pending = [];
					frame = 0;
					setLines((prev) => prev.concat(batch));
				});
			}
		});

		return () => {
			unsubscribe();
			cancelAnimationFrame(frame);
			closeWorkspaceLogs();
		};
	}, [closeWorkspaceLogs, onWorkspaceLogsAppend]);

	return lines;
}
