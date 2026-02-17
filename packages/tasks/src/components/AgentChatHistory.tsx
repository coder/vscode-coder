import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

import type { TaskLogEntry, TaskLogs } from "@repo/shared";

interface AgentChatHistoryProps {
	taskLogs: TaskLogs;
	isThinking: boolean;
}

function LogEntry({
	log,
	isGroupStart,
}: {
	log: TaskLogEntry;
	isGroupStart: boolean;
}) {
	return (
		<div className={`log-entry log-entry-${log.type}`}>
			{isGroupStart && (
				<div className="log-entry-role">
					{log.type === "input" ? "You" : "Agent"}
				</div>
			)}
			{log.content}
		</div>
	);
}

export function AgentChatHistory({
	taskLogs,
	isThinking,
}: AgentChatHistoryProps) {
	const logs = taskLogs.status === "ok" ? taskLogs.logs : [];

	return (
		<LogViewer header="Agent chat history">
			{logs.length === 0 ? (
				<LogViewerPlaceholder error={taskLogs.status === "error"}>
					{getEmptyMessage(taskLogs.status)}
				</LogViewerPlaceholder>
			) : (
				logs.map((log, index) => (
					<LogEntry
						key={log.id}
						log={log}
						isGroupStart={index === 0 || log.type !== logs[index - 1].type}
					/>
				))
			)}
			{isThinking && (
				<div className="log-entry log-entry-thinking">Thinking...</div>
			)}
		</LogViewer>
	);
}

function getEmptyMessage(status: TaskLogs["status"]): string {
	switch (status) {
		case "not_available":
			return "Logs not available in current task state";
		case "error":
			return "Failed to load logs";
		case "ok":
			return "No messages yet";
	}
}
