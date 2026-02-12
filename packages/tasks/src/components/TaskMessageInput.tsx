import { getTaskLabel, type Task, getTaskPermissions } from "@repo/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import { PromptInput } from "./PromptInput";

function getPlaceholder(task: Task): string {
	switch (task.status) {
		case "paused":
			return "Send a message to resume the task...";
		case "initializing":
		case "pending":
			return "Waiting for the agent to start...";
		case "error":
		case "unknown":
			return "Task is in an error state and cannot receive messages";
		case "active":
			break;
	}

	switch (task.current_state?.state) {
		case "working":
			return "Agent is working — you can pause or wait for it to finish...";
		case "complete":
			return "Task completed — send a follow-up to continue...";
		case "failed":
			return "Task failed — send a message to retry...";
		default:
			return "Send a message to the agent...";
	}
}

interface TaskMessageInputProps {
	task: Task;
}

export function TaskMessageInput({ task }: TaskMessageInputProps) {
	const api = useTasksApi();
	const [message, setMessage] = useState("");

	const { canPause, canSendMessage } = getTaskPermissions(task);
	const placeholder = getPlaceholder(task);
	const showPauseButton = task.current_state?.state === "working" && canPause;
	const canSubmitMessage = canSendMessage && message.trim().length > 0;

	const { mutate: pauseTask, isPending: isPausing } = useMutation({
		mutationFn: () =>
			api.pauseTask({ taskId: task.id, taskName: getTaskLabel(task) }),
	});

	const { mutate: sendMessage, isPending: isSending } = useMutation({
		mutationFn: (msg: string) => api.sendTaskMessage(task.id, msg),
		onSuccess: () => setMessage(""),
	});

	return (
		<PromptInput
			placeholder={placeholder}
			value={message}
			onChange={setMessage}
			onSubmit={showPauseButton ? pauseTask : () => sendMessage(message)}
			disabled={!canSendMessage && !showPauseButton}
			loading={showPauseButton ? isPausing : isSending}
			actionIcon={showPauseButton ? "debug-pause" : "send"}
			actionLabel={showPauseButton ? "Pause task" : "Send message"}
			actionDisabled={showPauseButton ? false : !canSubmitMessage}
		/>
	);
}
