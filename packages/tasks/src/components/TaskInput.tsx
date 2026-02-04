import { useTasksApi } from "@repo/webview-shared/react";
import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState } from "react";

import type { TaskUIState } from "@repo/webview-shared";

interface TaskInputProps {
	taskId: string;
	uiState: TaskUIState;
	canPause: boolean;
	errorMessage?: string | null;
}

function getPlaceholder(
	uiState: TaskUIState,
	errorMessage?: string | null,
): string {
	switch (uiState) {
		case "working":
			return "Agent is working...";
		case "idle":
			return "Type a message to the agent...";
		case "complete":
			return "Task completed";
		case "error":
			return errorMessage || "Error occurred...";
		case "paused":
			return "Task paused";
		case "initializing":
			return "Initializing...";
	}
}

export function TaskInput({
	taskId,
	uiState,
	canPause,
	errorMessage,
}: TaskInputProps) {
	const api = useTasksApi();
	const [message, setMessage] = useState("");
	const [isPausing, setIsPausing] = useState(false);
	const [isSending, setIsSending] = useState(false);

	const inputEnabled =
		uiState === "idle" || uiState === "complete" || uiState === "paused";
	const showPauseButton = uiState === "working" && canPause;
	const placeholder = getPlaceholder(uiState, errorMessage);

	const handleSend = () => {
		if (!message.trim() || !inputEnabled || isSending) return;
		setIsSending(true);
		api.sendTaskMessage(taskId, message.trim());
		setMessage("");
		setTimeout(() => setIsSending(false), 500);
	};

	const handlePause = async () => {
		if (isPausing) return;
		setIsPausing(true);
		try {
			await api.pauseTask(taskId);
		} catch {
			// Extension shows error notification
		} finally {
			setIsPausing(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && inputEnabled) {
			e.preventDefault();
			void handleSend();
		}
	};

	return (
		<div className="task-input-container">
			<textarea
				className="task-input"
				placeholder={placeholder}
				value={message}
				onChange={(e) => setMessage(e.target.value)}
				onKeyDown={handleKeyDown}
				disabled={!inputEnabled}
			/>
			<div className="task-input-button">
				{showPauseButton ? (
					isPausing ? (
						<VscodeProgressRing className="task-input-spinner" />
					) : (
						<VscodeIcon
							actionIcon
							name="debug-pause"
							label="Pause task"
							onClick={() => void handlePause()}
						/>
					)
				) : isSending ? (
					<VscodeProgressRing className="task-input-spinner" />
				) : (
					<VscodeIcon
						actionIcon
						name="send"
						label="Send message"
						onClick={
							inputEnabled && message.trim()
								? () => void handleSend()
								: undefined
						}
						className={!inputEnabled || !message.trim() ? "disabled" : ""}
					/>
				)}
			</div>
		</div>
	);
}
