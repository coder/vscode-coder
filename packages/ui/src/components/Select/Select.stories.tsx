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

interface Region {
	value: string;
	label: string;
	description?: string;
	disabled?: boolean;
}

const REGIONS: readonly Region[] = [
	{
		value: "us-pittsburgh",
		label: "US East (Pittsburgh)",
		description: "Lowest latency",
	},
	{ value: "eu-helsinki", label: "EU North (Helsinki)" },
	{ value: "ap-sydney", label: "Asia Pacific (Sydney)", disabled: true },
];

const ONE: readonly Region[] = [{ value: "one", label: "One" }];

const POOL_COUNT = 20;
const LAST_POOL = String(POOL_COUNT - 1);

const POOLS: readonly Region[] = Array.from(
	{ length: POOL_COUNT },
	(_, index) => ({
		value: String(index),
		label:
			index === POOL_COUNT - 1
				? "US East (Pittsburgh), dedicated high-memory workspace pool"
				: `Pool ${index}`,
		disabled: index === 1,
	}),
);

const Options = ({
	items,
	style,
}: {
	items: readonly Region[];
	style?: React.CSSProperties;
}): React.JSX.Element => (
	<SelectContent style={style}>
		{items.map(({ value, label, description, disabled }) => (
			<SelectItem
				key={value}
				value={value}
				description={description}
				disabled={disabled}
			>
				{label}
			</SelectItem>
		))}
	</SelectContent>
);

const RegionSelect = (): React.JSX.Element => {
	const [region, setRegion] = useState("us-pittsburgh");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<Select
				items={REGIONS}
				value={region}
				onValueChange={(value) => setRegion(value ?? "")}
			>
				<SelectTrigger aria-label="Region">
					<SelectValue placeholder="Select a region" />
				</SelectTrigger>
				<Options items={REGIONS} />
			</Select>
			<Select items={ONE} value="" onValueChange={() => undefined}>
				<SelectTrigger aria-label="Placeholder">
					<SelectValue placeholder="Select an option" />
				</SelectTrigger>
				<Options items={ONE} />
			</Select>
			<Select items={ONE} value="one" onValueChange={() => undefined} disabled>
				<SelectTrigger aria-label="Disabled">
					<SelectValue />
				</SelectTrigger>
				<Options items={ONE} />
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
			<Select items={POOLS} defaultValue={LAST_POOL}>
				<SelectTrigger aria-label="Workspace pool">
					<SelectValue />
				</SelectTrigger>
				<Options items={POOLS} style={{ maxHeight: "150px" }} />
			</Select>
		</div>
	),
	// The selected row is last, so opening scrolls the viewport to the end.
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("combobox", { name: "Workspace pool" }),
		);
		await screen.findByRole("listbox");
	},
};
