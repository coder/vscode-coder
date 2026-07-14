import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { FourThemeModes } from "../../storybook";

import { SearchInput } from "./SearchInput";

import type { Meta, StoryObj } from "@storybook/react-vite";

const SearchStates = (): React.JSX.Element => {
	const [value, setValue] = useState("development");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<SearchInput
				value={value}
				label="Search workspaces"
				placeholder="Search workspaces"
				onChange={setValue}
			/>
			<SearchInput
				value=""
				onChange={() => undefined}
				label="Search disabled"
				placeholder="Search disabled"
				disabled
			/>
		</div>
	);
};

const meta: Meta<typeof SearchStates> = {
	title: "UI/SearchInput",
	component: SearchStates,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof SearchStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const searchbox = canvas.getByRole("searchbox", {
			name: "Search workspaces",
		});

		await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
		await expect(searchbox).toHaveValue("");
		await expect(searchbox).toHaveFocus();
		searchbox.blur();
	},
};
