import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@repo/ui";

import { expectRootStyling, rootStyling } from "./helpers";

// jsdom lacks the pointer-capture and scrolling APIs Radix Select uses.
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const RegionSelect = ({
	onValueChange,
	value = "",
	disabled,
}: {
	onValueChange: (value: string) => void;
	value?: string;
	disabled?: boolean;
}): React.JSX.Element => (
	<Select value={value} onValueChange={onValueChange} disabled={disabled}>
		<SelectTrigger aria-label="Region">
			<SelectValue placeholder="Select a region" />
		</SelectTrigger>
		<SelectContent>
			<SelectItem value="us-pittsburgh" description="Lowest latency">
				US East
			</SelectItem>
			<SelectItem value="eu-helsinki">EU North</SelectItem>
		</SelectContent>
	</Select>
);

const getTrigger = (name = "Region"): HTMLElement =>
	screen.getByRole("combobox", { name });

const getOption = (name: string): HTMLElement =>
	screen.getByRole("option", { name });

describe("Select", () => {
	it("opens with the keyboard and reports the selected value", () => {
		const onValueChange = vi.fn();
		render(<RegionSelect onValueChange={onValueChange} />);

		fireEvent.keyDown(getTrigger(), { key: "Enter" });
		fireEvent.keyDown(getOption("US East"), { key: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith("us-pittsburgh");
	});

	it("shows the placeholder until a value is set, then the item text", () => {
		const { rerender } = render(
			<RegionSelect onValueChange={vi.fn()} value="" />,
		);
		expect(getTrigger()).toHaveTextContent("Select a region");

		rerender(<RegionSelect onValueChange={vi.fn()} value="eu-helsinki" />);
		expect(getTrigger()).toHaveTextContent("EU North");
	});

	it("renders option descriptions alongside consumer descriptions", () => {
		render(
			<Select defaultValue="us-pittsburgh" defaultOpen>
				<SelectTrigger aria-label="Region">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<span id="hint">Available now.</span>
					<SelectItem
						value="us-pittsburgh"
						description="Lowest latency"
						aria-describedby="hint"
					>
						US East
					</SelectItem>
					<SelectItem value="eu-helsinki">EU North</SelectItem>
				</SelectContent>
			</Select>,
		);
		expect(getOption("US East")).toHaveAccessibleDescription(
			"Available now. Lowest latency",
		);
		expect(getOption("EU North")).not.toHaveAttribute("aria-describedby");
		expect(screen.getByText("Lowest latency")).toHaveClass(
			"ui-select__item-description",
		);
	});

	it("skips disabled options and selects the last one with End", async () => {
		const onValueChange = vi.fn();
		render(
			<Select defaultValue="0" onValueChange={onValueChange}>
				<SelectTrigger aria-label="Workspace pool">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{Array.from({ length: 20 }, (_, index) => (
						<SelectItem
							key={index}
							value={String(index)}
							disabled={index === 1}
						>
							{`Pool ${index}`}
						</SelectItem>
					))}
				</SelectContent>
			</Select>,
		);
		const trigger = getTrigger("Workspace pool");
		fireEvent.keyDown(trigger, { key: "Enter" });
		expect(getOption("Pool 1")).toHaveAttribute("aria-disabled", "true");
		// Radix moves item focus on a timeout, so each step settles first.
		await waitFor(() => expect(getOption("Pool 0")).toHaveFocus());

		fireEvent.keyDown(getOption("Pool 0"), { key: "ArrowDown" });
		await waitFor(() => expect(getOption("Pool 2")).toHaveFocus());

		fireEvent.keyDown(getOption("Pool 2"), { key: "End" });
		await waitFor(() => expect(getOption("Pool 19")).toHaveFocus());

		fireEvent.keyDown(getOption("Pool 19"), { key: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith("19");
		expect(trigger).toHaveTextContent("Pool 19");
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it("does not open when disabled", () => {
		render(
			<RegionSelect onValueChange={vi.fn()} value="eu-helsinki" disabled />,
		);
		expect(getTrigger()).toBeDisabled();
		fireEvent.keyDown(getTrigger(), { key: "Enter" });
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});

	it("forwards className and style to the trigger", () => {
		expectRootStyling(
			<Select value="" onValueChange={vi.fn()}>
				<SelectTrigger aria-label="Region" {...rootStyling}>
					<SelectValue placeholder="Pick" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="one">One</SelectItem>
				</SelectContent>
			</Select>,
			() => getTrigger().closest(".ui-select__trigger"),
		);
	});
});
