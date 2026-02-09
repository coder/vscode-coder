import { useEffect, useRef } from "react";

import type { LogsStatus, TaskLogEntry } from "@repo/shared";

interface AgentChatHistoryProps {
	logs: TaskLogEntry[];
	logsStatus: LogsStatus;
	isThinking: boolean;
}

function getEmptyMessage(logsStatus: LogsStatus): string {
	switch (logsStatus) {
		case "not_available":
			return "Logs not available in current task state";
		case "error":
			return "Failed to load logs";
		default:
			return "No messages yet";
	}
}

export function AgentChatHistory({
	logs,
	logsStatus,
	isThinking,
}: AgentChatHistoryProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isAtBottomRef = useRef(true);

	const handleScroll = () => {
		const container = containerRef.current;
		if (!container) return;
		const distanceFromBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		isAtBottomRef.current = distanceFromBottom <= 50;
	};

	useEffect(() => {
		if (containerRef.current && isAtBottomRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [logs, isThinking]);

	return (
		<div className="agent-chat-history">
			<div className="chat-history-header">Agent chat history</div>
			<div
				className="chat-history-content"
				ref={containerRef}
				onScroll={handleScroll}
			>
				{logs.length === 0 ? (
					<div
						className={[
							"chat-history-empty",
							logsStatus === "error" && "chat-history-error",
						]
							.filter(Boolean)
							.join(" ")}
					>
						{getEmptyMessage(logsStatus)}
					</div>
				) : (
					logs.map((log) => (
						<div key={log.id} className="log-entry">
							{log.content}
						</div>
					))
				)}
				{isThinking && (
					<div className="log-entry log-entry-thinking">Thinking...</div>
				)}
			</div>
		</div>
	);
}
