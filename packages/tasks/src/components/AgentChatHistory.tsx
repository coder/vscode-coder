import { VscodeScrollable } from "@vscode-elements/react-elements";

import { useFollowScroll } from "../hooks/useFollowScroll";

import type { LogsStatus, TaskLogEntry } from "@repo/shared";

interface AgentChatHistoryProps {
	logs: TaskLogEntry[];
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
	const bottomRef = useFollowScroll();

	return (
		<div className="agent-chat-history">
			<div className="chat-history-header">Agent chat history</div>
			<VscodeScrollable className="chat-history-content">
				{logs.length === 0 ? (
					<div
						className={
							logsStatus === "error"
								? "chat-history-empty chat-history-error"
								: "chat-history-empty"
						}
					>
						{getEmptyMessage(logsStatus)}
					</div>
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
				<div ref={bottomRef} />
			</VscodeScrollable>
		</div>
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
