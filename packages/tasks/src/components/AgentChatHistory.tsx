import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

import type { LogsStatus, TaskLogEntry } from "@repo/shared";

interface AgentChatHistoryProps {
	logs: readonly TaskLogEntry[];
	logsStatus: LogsStatus;
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
	logs,
	logsStatus,
	isThinking,
}: AgentChatHistoryProps) {
	const isEmpty = logs.length === 0 && (logsStatus !== "ok" || !isThinking);

	return (
		<LogViewer header="Agent chat history">
			{isEmpty ? (
				<LogViewerPlaceholder error={logsStatus === "error"}>
					{getEmptyMessage(logsStatus)}
				</LogViewerPlaceholder>
			) : (
				<>
					{logs.map((log, index) => (
						<LogEntry
							key={log.id}
							log={log}
							isGroupStart={index === 0 || log.type !== logs[index - 1].type}
						/>
					))}
					{isThinking && (
						<div className="log-entry log-entry-thinking">Thinking...</div>
					)}
				</>
			)}
		</LogViewer>
	);
}

function getEmptyMessage(logsStatus: LogsStatus): string {
	switch (logsStatus) {
		case "not_available":
			return "Logs not available in current task state";
		case "error":
			return "Failed to load logs";
		case "ok":
			return "No messages yet";
	}
}
