import { logEntry } from "@repo/mocks";
import { AgentChatHistory } from "./AgentChatHistory";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof AgentChatHistory> = {
	title: "Tasks/AgentChatHistory",
	component: AgentChatHistory,
};

export default meta;
type Story = StoryObj<typeof AgentChatHistory>;

export const Default: Story = {
	args: {
		isThinking: false,
		taskLogs: {
			status: "ok",
			logs: [
				logEntry({
					id: 1,
					type: "input",
					content: "What is the weather today?",
				}),
				logEntry({
					id: 2,
					type: "output",
					content: "The weather today is sunny with a high of 25°C.",
				}),
			],
		},
	},
};

export const Empty: Story = {
	args: {
		isThinking: false,
		taskLogs: {
			status: "ok",
			snapshot: false,
			logs: [],
		},
	},
};

export const Thinking: Story = {
	args: {
		isThinking: true,
		taskLogs: {
			status: "ok",
			logs: [
				logEntry({
					id: 1,
					type: "input",
					content: "What is the weather today?",
				}),
				logEntry({
					id: 2,
					type: "output",
					content: "The weather today is sunny with a high of 25°C.",
				}),
			],
		},
	},
};

export const Error: Story = {
	args: {
		isThinking: false,
		taskLogs: {
			status: "error",
		},
	},
};

export const Snapshot: Story = {
	args: {
		taskLogs: {
			status: "ok",
			logs: [],
			snapshot: true,
			snapshotAt: "2024-01-01T12:00:00Z",
		},
	},
};

export const NotAvailable: Story = {
	args: {
		taskLogs: {
			status: "not_available",
		},
	},
};
