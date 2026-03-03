import {
	logPreviewLabel,
	type TaskLogEntry,
	type TaskLogs,
} from "@repo/shared";
import { formatDistanceToNowStrict } from "date-fns";

import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

import type { ReactNode } from "react";

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
					{log.type === "input" ? "[User]" : "[Agent]"}
				</div>
			)}
			{log.content}
		</div>
	);
}

function chatHistoryHeader(taskLogs: TaskLogs): ReactNode {
	if (taskLogs.status !== "ok" || taskLogs.snapshot !== true) {
		return "Chat history";
	}
	const label = logPreviewLabel(taskLogs.logs.length);
	if (taskLogs.snapshotAt === undefined) {
		return label;
	}
	const relativeTime = formatDistanceToNowStrict(
		new Date(taskLogs.snapshotAt),
		{ addSuffix: true },
	);
	return (
		<>
			{label}{" "}
			<span className="snapshot-info">
				<span className="codicon codicon-info" />
				<span className="snapshot-info-tooltip">
					Snapshot taken {relativeTime}
				</span>
			</span>
		</>
	);
}

export function AgentChatHistory({
	taskLogs,
	isThinking,
}: AgentChatHistoryProps) {
	const logs = taskLogs.status === "ok" ? taskLogs.logs : [];

	return (
		<LogViewer header={chatHistoryHeader(taskLogs)}>
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
			return "Messages are not available yet";
		case "error":
			return "Failed to load messages";
		case "ok":
			return "No messages yet";
	}
}
