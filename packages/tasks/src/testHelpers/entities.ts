import { Task, TaskDetails, TaskLogs } from "@repo/shared";

export const MockTask: Task = {
	id: "task-1",
	name: "Task 1",
	status: "active",
	organization_id: "",
	owner_id: "",
	owner_name: "",
	display_name: "",
	template_id: "",
	template_version_id: "",
	template_name: "",
	template_display_name: "",
	template_icon: "",
	workspace_id: null,
	workspace_name: "helpful-assistant",
	workspace_agent_id: null,
	workspace_agent_lifecycle: null,
	workspace_agent_health: null,
	workspace_app_id: null,
	initial_prompt: "You are a helpful assistant.",
	current_state: null,
	created_at: "2024-06-01T10:00:00Z",
	updated_at: "2024-06-01T10:00:00Z",
};

export const MockTaskLogs: TaskLogs = {
	status: "ok",
	logs: [
		{
			id: 1,
			type: "input",
			content: "What is the weather today?",
			time: "2024-06-01T10:01:00Z",
		},
		{
			id: 2,
			type: "output",
			content: "The weather today is sunny with a high of 25°C.",
			time: "2024-06-01T10:01:05Z",
		},
	],
};

export const MockTaskDetails: TaskDetails = {
	task: MockTask,
	logs: MockTaskLogs,
	canPause: true,
	pauseDisabled: false,
	canResume: false,
	canSendMessage: true,
};
