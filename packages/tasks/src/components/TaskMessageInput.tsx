import { getTaskLabel, type Task, getTaskPermissions } from "@repo/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import { PromptInput } from "./PromptInput";

function getPlaceholder(task: Task): string {
	if (task.status === "error" || task.current_state?.state === "failed") {
		return "Send a message to retry or give new instructions...";
	}
	if (task.status === "paused") {
		return "Send a message to resume the task...";
	}
	if (task.status === "pending" || task.status === "initializing") {
		return "Waiting for the agent to start...";
	}
	if (task.current_state?.state === "working") {
		return "Agent is working — you can pause or wait for it to finish...";
	}
	if (task.current_state?.state === "complete") {
		return "Task completed — send a follow-up message to continue...";
	}
	return "Send a message to the agent...";
}

function isInputEnabled(task: Task): boolean {
	const state = task.current_state?.state;
	return (
		state === "idle" ||
		state === "complete" ||
		state === "failed" ||
		task.status === "paused"
	);
}

interface TaskMessageInputProps {
	task: Task;
}

export function TaskMessageInput({ task }: TaskMessageInputProps) {
	const api = useTasksApi();
	const [message, setMessage] = useState("");

	const { canPause } = getTaskPermissions(task);
	const inputEnabled = isInputEnabled(task);
	const showPauseButton = task.current_state?.state === "working" && canPause;

	const { mutate: sendMessage, isPending: isSending } = useMutation({
		mutationFn: (msg: string) => api.sendTaskMessage(task.id, msg),
		onSuccess: () => setMessage(""),
	});

	const { mutate: pauseTask, isPending: isPausing } = useMutation({
		mutationFn: () =>
			api.pauseTask({ taskId: task.id, taskName: getTaskLabel(task) }),
	});

	const handleSend = () => {
		if (!message.trim() || !inputEnabled || isSending) return;
		sendMessage(message.trim());
	};

	return (
		<PromptInput
			placeholder={getPlaceholder(task)}
			value={message}
			onChange={setMessage}
			onSubmit={showPauseButton ? pauseTask : handleSend}
			disabled={!inputEnabled}
			loading={showPauseButton ? isPausing : isSending}
			actionIcon={showPauseButton ? "debug-pause" : "send"}
			actionLabel={showPauseButton ? "Pause task" : "Send message"}
			actionDisabled={!showPauseButton && (!inputEnabled || !message.trim())}
		/>
	);
}
