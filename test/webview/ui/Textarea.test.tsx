import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "@repo/ui";

describe("Textarea", () => {
	it("reports changes without owning the value", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<Textarea value="" onChange={onChange} aria-label="Init script" />,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Init script" }), {
			target: { value: "echo hi" },
		});
		expect(onChange).toHaveBeenCalledWith("echo hi");
		expect(screen.getByRole("textbox", { name: "Init script" })).toHaveValue(
			"",
		);

		rerender(
			<Textarea value="echo hi" onChange={onChange} aria-label="Init script" />,
		);
		expect(screen.getByRole("textbox", { name: "Init script" })).toHaveValue(
			"echo hi",
		);
	});

	it("disables the native control", () => {
		render(
			<Textarea value="" onChange={vi.fn()} disabled aria-label="Disabled" />,
		);
		expect(screen.getByRole("textbox", { name: "Disabled" })).toBeDisabled();
	});

	it("forwards className and style to the root element", () => {
		render(
			<Textarea
				value=""
				onChange={vi.fn()}
				className="custom-textarea"
				style={{ height: "120px" }}
				aria-label="Init script"
			/>,
		);
		const root = screen.getByRole("textbox", { name: "Init script" });
		expect(root).toHaveClass("ui-textarea", "custom-textarea");
		expect(root).toHaveStyle({ height: "120px" });
	});
});
