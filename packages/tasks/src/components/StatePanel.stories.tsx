import { VscodeButton, VscodeIcon } from "@vscode-elements/react-elements";
import { StatePanel } from "./StatePanel";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof StatePanel> = {
	title: "Tasks/StatePanel",
	component: StatePanel,
	args: {
		title: "Tasks not available",
		description: "This Coder server does not support tasks.",
		action: (
			<a href="/" className="text-link">
				Learn more <VscodeIcon name="link-external" />
			</a>
		),
	},
};

export default meta;
type Story = StoryObj<typeof StatePanel>;

export const Default: Story = {};

export const Error: Story = {
	args: {
		className: "error-state",
		description: "Unable to load tasks right now.",
		action: <VscodeButton>Retry</VscodeButton>,
	},
};
