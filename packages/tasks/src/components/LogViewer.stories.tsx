import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof LogViewer> = {
	title: "Tasks/LogViewer",
	component: LogViewer,
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
