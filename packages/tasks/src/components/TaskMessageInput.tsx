import { getTaskLabel, type Task, getTaskPermissions } from "@repo/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import { PromptInput } from "./PromptInput";

interface InputState {
	placeholder: string;
	canSend: boolean;
}

function getInputState(task: Task): InputState {
	const state = task.current_state?.state;

	switch (task.status) {
		case "paused":
			return {
				placeholder: "Send a message to resume the task...",
				canSend: true,
			};
		case "initializing":
		case "pending":
			return {
				placeholder: "Waiting for the agent to start...",
				canSend: false,
			};
		case "active":
			switch (state) {
				case "working":
					return {
						placeholder:
							"Agent is working — you can pause or wait for it to finish...",
						canSend: false,
					};
				case "complete":
					return {
						placeholder: "Task completed — send a follow-up to continue...",
						canSend: true,
					};
				case "failed":
					return {
						placeholder: "Task failed — send a message to retry...",
						canSend: true,
					};
				default:
					return {
						placeholder: "Send a message to the agent...",
						canSend: true,
					};
			}
		case "error":
		case "unknown":
			return {
				placeholder: "Task is in an error state and cannot receive messages",
				canSend: false,
			};
	}
}

interface TaskMessageInputProps {
	task: Task;
}

export function TaskMessageInput({ task }: TaskMessageInputProps) {
	const api = useTasksApi();
	const [message, setMessage] = useState("");

	const { canPause } = getTaskPermissions(task);
	const { placeholder, canSend } = getInputState(task);
	const showPauseButton = task.current_state?.state === "working" && canPause;

	const { mutate: pauseTask, isPending: isPausing } = useMutation({
		mutationFn: () =>
			api.pauseTask({ taskId: task.id, taskName: getTaskLabel(task) }),
	});

	const { mutate: sendMessage, isPending: isSending } = useMutation({
		mutationFn: () => api.sendTaskMessage(task.id, message),
		onSuccess: () => setMessage(""),
	});

	const canSubmitMessage = canSend && message.trim().length > 0;

	return (
		<PromptInput
			placeholder={placeholder}
			value={message}
			onChange={setMessage}
			onSubmit={showPauseButton ? pauseTask : sendMessage}
			disabled={!canSend && !showPauseButton}
			loading={showPauseButton ? isPausing : isSending}
			actionIcon={showPauseButton ? "debug-pause" : "send"}
			actionLabel={showPauseButton ? "Pause task" : "Send message"}
			actionDisabled={showPauseButton ? false : !canSubmitMessage}
		/>
	);
}
