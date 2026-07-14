import { expect, within } from "storybook/test";

import { FourThemeModes } from "../storybook";

import { Icon } from "./Icon";

import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CodiconName } from "../codicons";

const galleryIcons = [
	"account",
	"add",
	"alert",
	"check",
	"close",
	"error",
	"info",
	"refresh",
	"search",
	"settings-gear",
	"trash",
	"workspace-trusted",
] as const satisfies readonly CodiconName[];

const IconStates = (): React.JSX.Element => (
	<div style={{ display: "flex", gap: "16px", fontSize: "20px" }}>
		<Icon name="workspace-trusted" />
		<Icon name="alert" aria-label="Warning" />
		<Icon name="loading" spin aria-label="Syncing" />
	</div>
);

const meta: Meta<typeof IconStates> = {
	title: "UI/Icon",
	component: IconStates,
};
export default meta;
type Story = StoryObj<typeof IconStates>;

export const States: Story = {
	parameters: { chromatic: { modes: FourThemeModes } },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("img", { name: "Syncing" }),
		).toHaveClass("ui-icon--spin");
	},
};

export const Gallery: Story = {
	render: () => (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(4, 1fr)",
				gap: "12px",
				fontSize: "20px",
			}}
		>
			{galleryIcons.map((name) => (
				<Icon key={name} name={name} title={name} />
			))}
		</div>
	),
	parameters: { chromatic: { disableSnapshot: true } },
};
