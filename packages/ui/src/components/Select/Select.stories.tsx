import { useState } from "react";
import { expect, screen, userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./Select";

import type { Meta, StoryObj } from "@storybook/react-vite";

const RegionSelect = (): React.JSX.Element => {
	const [region, setRegion] = useState("us-pittsburgh");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<Select value={region} onValueChange={setRegion}>
				<SelectTrigger aria-label="Region">
					<SelectValue placeholder="Select a region" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="us-pittsburgh" description="Lowest latency">
						US East (Pittsburgh)
					</SelectItem>
					<SelectItem value="eu-helsinki">EU North (Helsinki)</SelectItem>
					<SelectItem value="ap-sydney" disabled>
						Asia Pacific (Sydney)
					</SelectItem>
				</SelectContent>
			</Select>
			<Select value="" onValueChange={() => undefined}>
				<SelectTrigger aria-label="Placeholder">
					<SelectValue placeholder="Select an option" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="one">One</SelectItem>
				</SelectContent>
			</Select>
			<Select value="one" onValueChange={() => undefined} disabled>
				<SelectTrigger aria-label="Disabled">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="one">One</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
};

const meta: Meta<typeof RegionSelect> = {
	title: "UI/Select",
	component: RegionSelect,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof RegionSelect>;

export const States: Story = {};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "Region" }));
		await screen.findByRole("listbox");
		await expect(
			screen.getByRole("option", { name: /US East/ }),
		).toBeInTheDocument();
		await expect(screen.getByText("Lowest latency")).toBeInTheDocument();
	},
};

export const Selection: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("combobox", { name: "Region" });
		await userEvent.click(trigger);
		await userEvent.click(
			await screen.findByRole("option", { name: /Helsinki/ }),
		);
		await expect(trigger).toHaveTextContent("EU North (Helsinki)");
	},
};
