import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@repo/ui";

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

describe("Select", () => {
	it("opens with the keyboard and reports the selected value", () => {
		const onValueChange = vi.fn();
		render(<RegionSelect onValueChange={onValueChange} />);
		const trigger = screen.getByRole("combobox", { name: "Region" });

		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.keyDown(screen.getByRole("option", { name: "US East" }), {
			key: "Enter",
		});
		expect(onValueChange).toHaveBeenCalledWith("us-pittsburgh");
	});

	it("shows the placeholder until a value is set, then the item text", () => {
		const { rerender } = render(
			<RegionSelect onValueChange={vi.fn()} value="" />,
		);
		const trigger = screen.getByRole("combobox", { name: "Region" });
		expect(trigger).toHaveTextContent("Select a region");

		rerender(<RegionSelect onValueChange={vi.fn()} value="eu-helsinki" />);
		expect(trigger).toHaveTextContent("EU North");
	});

	it("renders option descriptions in the open list", () => {
		render(<RegionSelect onValueChange={vi.fn()} />);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Region" }), {
			key: "Enter",
		});
		expect(
			screen.getByRole("option", { name: "US East" }),
		).toHaveAccessibleDescription("Lowest latency");
		expect(
			screen.getByRole("option", { name: "EU North" }),
		).not.toHaveAttribute("aria-describedby");
		expect(screen.getByText("Lowest latency")).toHaveClass(
			"ui-select__item-description",
		);
	});

	it("preserves consumer descriptions alongside the option description", () => {
		render(
			<Select defaultValue="one" defaultOpen>
				<SelectTrigger aria-label="Region">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<span id="hint">Available now.</span>
					<SelectItem
						value="one"
						description="Lowest latency"
						aria-describedby="hint"
					>
						US East
					</SelectItem>
				</SelectContent>
			</Select>,
		);
		expect(
			screen.getByRole("option", { name: "US East" }),
		).toHaveAccessibleDescription("Available now. Lowest latency");
	});

	it("does not open when disabled", () => {
		render(
			<RegionSelect onValueChange={vi.fn()} value="eu-helsinki" disabled />,
		);
		const trigger = screen.getByRole("combobox", { name: "Region" });
		expect(trigger).toBeDisabled();
		fireEvent.keyDown(trigger, { key: "Enter" });
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});

	it("forwards className and style to the trigger", () => {
		render(
			<Select value="" onValueChange={vi.fn()}>
				<SelectTrigger
					aria-label="Region"
					className="custom-trigger"
					style={{ width: "120px" }}
				>
					<SelectValue placeholder="Pick" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="one">One</SelectItem>
				</SelectContent>
			</Select>,
		);
		const trigger = screen.getByRole("combobox", { name: "Region" });
		expect(trigger).toHaveClass("ui-select__trigger", "custom-trigger");
		expect(trigger).toHaveStyle({ width: "120px" });
	});
});
