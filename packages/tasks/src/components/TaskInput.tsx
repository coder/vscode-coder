import { getTaskLabel, type Task } from "@repo/shared";
import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

interface TaskInputProps {
	taskId: string;
	task: Task;
	canPause: boolean;
}

function getPlaceholder(task: Task): string {
	if (task.status === "error" || task.current_state?.state === "failed") {
		return task.current_state?.message || "Error occurred...";
	}
	if (task.status === "paused") {
		return "Task paused";
	}
	if (task.status === "pending" || task.status === "initializing") {
		return "Initializing...";
	}
	if (task.current_state?.state === "working") {
		return "Agent is working...";
	}
	if (task.current_state?.state === "complete") {
		return "Task completed";
	}
	return "Type a message to the agent...";
}

function isInputEnabled(task: Task): boolean {
	const state = task.current_state?.state;
	return state === "idle" || state === "complete" || task.status === "paused";
}

export function TaskInput({ taskId, task, canPause }: TaskInputProps) {
	const api = useTasksApi();
	const [message, setMessage] = useState("");
	const [isPausing, setIsPausing] = useState(false);
	const [isSending, setIsSending] = useState(false);

	const inputEnabled = isInputEnabled(task);
	const showPauseButton = task.current_state?.state === "working" && canPause;
	const placeholder = getPlaceholder(task);

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
			await api.pauseTask({ taskId: task.id, taskName: getTaskLabel(task) });
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
