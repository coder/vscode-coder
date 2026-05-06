import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

import { withTasksStyles } from "../utils/storybook";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof LogViewer> = {
	title: "Tasks/LogViewer",
	component: LogViewer,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof LogViewer>;

export const Default: Story = {
	args: {
		header: "Task Logs",
		children: (
			<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
				<div>Entry 1</div>
				<div>Entry 2</div>
				<div>Entry 3</div>
			</div>
		),
	},
};

export const Loading: Story = {
	args: {
		header: "Task Logs",
		children: <LogViewerPlaceholder>Loading logs...</LogViewerPlaceholder>,
	},
};

export const WithError: Story = {
	args: {
		header: "Task Logs",
		children: (
			<LogViewerPlaceholder error>Failed to load logs.</LogViewerPlaceholder>
		),
	},
};
