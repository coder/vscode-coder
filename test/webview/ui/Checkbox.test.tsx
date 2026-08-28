import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "@repo/ui";

describe("Checkbox", () => {
	it("reports toggles without owning the checked state", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<Checkbox checked={false} onChange={onChange}>
				Start on connect
			</Checkbox>,
		);
		const checkbox = screen.getByRole("checkbox", { name: "Start on connect" });
		fireEvent.click(checkbox);
		expect(onChange).toHaveBeenCalledWith(true);
		expect(checkbox).not.toBeChecked();

		rerender(
			<Checkbox checked onChange={onChange}>
				Start on connect
			</Checkbox>,
		);
		expect(checkbox).toBeChecked();
	});

	it("toggles from a click on its label text", () => {
		const onChange = vi.fn();
		render(
			<Checkbox checked onChange={onChange}>
				Start on connect
			</Checkbox>,
		);
		fireEvent.click(screen.getByText("Start on connect"));
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it("does not fire when disabled", () => {
		const onChange = vi.fn();
		render(
			<Checkbox checked={false} disabled onChange={onChange}>
				Disabled
			</Checkbox>,
		);
		fireEvent.click(screen.getByText("Disabled"));
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.getByRole("checkbox", { name: "Disabled" })).toBeDisabled();
	});

	it("forwards className and style to the root element", () => {
		render(
			<Checkbox
				checked={false}
				onChange={vi.fn()}
				className="custom-checkbox"
				style={{ marginTop: "4px" }}
			>
				Styled
			</Checkbox>,
		);
		const root = screen
			.getByRole("checkbox", { name: "Styled" })
			.closest(".ui-checkbox");
		expect(root).toHaveClass("custom-checkbox");
		expect(root).toHaveStyle({ marginTop: "4px" });
	});
});
