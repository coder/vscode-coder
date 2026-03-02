import { useEffect, useState } from "react";

import { useTasksApi } from "./useTasksApi";

export interface LogEntry {
	id: number;
	text: string;
}

/**
 * Subscribes to workspace log lines pushed from the extension.
 * Batches updates per animation frame to avoid excessive re-renders
 * when many lines arrive in quick succession.
 */
export function useWorkspaceLogs(): LogEntry[] {
	const { onWorkspaceLogsAppend, stopStreamingWorkspaceLogs } = useTasksApi();
	const [lines, setLines] = useState<LogEntry[]>([]);

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
					setLines((prev) => {
						const entries = batch.map((text, i) => ({
							id: prev.length + i,
							text,
						}));
						return prev.concat(entries);
					});
				});
			}
		});

		return () => {
			unsubscribe();
			cancelAnimationFrame(frame);
			stopStreamingWorkspaceLogs();
		};
	}, [stopStreamingWorkspaceLogs, onWorkspaceLogsAppend]);

	return lines;
}
