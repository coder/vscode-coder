import type { Meta, StoryObj } from "@storybook/react";
import { AgentChatHistory } from "./AgentChatHistory";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof AgentChatHistory> = {
	title: "Tasks/AgentChatHistory",
	component: AgentChatHistory,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof AgentChatHistory>;

export const Default: Story = {
	args: {
		isThinking: false,
		taskLogs: M.MockTaskLogs,
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
		taskLogs: M.MockTaskLogs,
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
