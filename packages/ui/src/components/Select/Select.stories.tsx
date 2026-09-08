import { useState } from "react";
import { screen, userEvent, within } from "storybook/test";

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

export const Focused: Story = {
	play: ({ canvasElement }) => {
		within(canvasElement).getByRole("combobox", { name: "Region" }).focus();
	},
};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "Region" }));
		await screen.findByRole("listbox");
	},
};

export const LongList: Story = {
	render: () => (
		<div style={{ width: "180px" }}>
			<Select defaultValue="0">
				<SelectTrigger aria-label="Workspace pool">
					<SelectValue />
				</SelectTrigger>
				<SelectContent style={{ maxHeight: "150px" }}>
					{Array.from({ length: 20 }, (_, index) => (
						<SelectItem
							key={index}
							value={String(index)}
							disabled={index === 1}
						>
							{index === 0
								? "US East (Pittsburgh) — dedicated high-memory workspace pool"
								: `Pool ${index}`}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	),
	// Scroll to the end of the list so the snapshot shows a scrolled viewport.
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("combobox", { name: "Workspace pool" }),
		);
		await screen.findByRole("listbox");
		await userEvent.keyboard("{End}");
	},
};
