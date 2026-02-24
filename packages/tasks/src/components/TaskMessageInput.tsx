import {
	getTaskLabel,
	getTaskPermissions,
	isTaskWorking,
	type Task,
} from "@repo/shared";
import { logger } from "@repo/webview-shared/logger";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import { PromptInput, type PromptInputProps } from "./PromptInput";

type ActionProps = Pick<
	PromptInputProps,
	| "onSubmit"
	| "disabled"
	| "loading"
	| "actionIcon"
	| "actionLabel"
	| "actionEnabled"
>;

function getPlaceholder(task: Task): string {
	switch (task.status) {
		case "paused":
			return "Resume the task to send messages";
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

	const { mutate: pauseTask, isPending: isPausing } = useMutation({
		mutationFn: () =>
			api.pauseTask({ taskId: task.id, taskName: getTaskLabel(task) }),
		onError: (err) => logger.error("Failed to pause task", err),
	});

	const { mutate: resumeTask, isPending: isResuming } = useMutation({
		mutationFn: () =>
			api.resumeTask({ taskId: task.id, taskName: getTaskLabel(task) }),
		onError: (err) => logger.error("Failed to resume task", err),
	});

	const { mutate: sendMessage, isPending: isSending } = useMutation({
		mutationFn: (msg: string) =>
			api.sendTaskMessage({ taskId: task.id, message: msg }),
		onSuccess: () => setMessage(""),
		onError: (err) => logger.error("Failed to send message", err),
	});

	const { canPause, canResume, canSendMessage } = getTaskPermissions(task);

	let actionProps: ActionProps;
	if (isTaskWorking(task) && canPause) {
		actionProps = {
			onSubmit: pauseTask,
			loading: isPausing,
			actionIcon: "debug-pause",
			actionLabel: "Pause task",
			disabled: false,
			actionEnabled: true,
		};
	} else if (canResume) {
		actionProps = {
			onSubmit: resumeTask,
			loading: isResuming,
			actionIcon: "debug-start",
			actionLabel: "Resume task",
			disabled: true,
			actionEnabled: true,
		};
	} else {
		actionProps = {
			onSubmit: () => sendMessage(message),
			loading: isSending,
			actionIcon: "send",
			actionLabel: "Send message",
			disabled: !canSendMessage,
			actionEnabled: canSendMessage && message.trim().length > 0,
		};
	}

	return (
		<PromptInput
			placeholder={getPlaceholder(task)}
			value={message}
			onChange={setMessage}
			{...actionProps}
		/>
	);
}
