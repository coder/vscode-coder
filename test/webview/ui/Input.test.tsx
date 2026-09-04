import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@repo/ui";

import type { SubmitEvent } from "react";

describe("Input", () => {
	it("reports changes without owning the value", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<Input value="" onChange={onChange} aria-label="Region" />,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Region" }), {
			target: { value: "us" },
		});
		expect(onChange).toHaveBeenCalledWith("us");
		expect(screen.getByRole("textbox", { name: "Region" })).toHaveValue("");

		rerender(<Input value="us" onChange={onChange} aria-label="Region" />);
		expect(screen.getByRole("textbox", { name: "Region" })).toHaveValue("us");
	});

	it("passes number constraints through to the native input", () => {
		render(
			<Input
				value="8"
				onChange={vi.fn()}
				type="number"
				min={1}
				max={16}
				aria-label="CPU cores"
			/>,
		);
		const input = screen.getByRole("spinbutton", { name: "CPU cores" });
		expect(input).toHaveAttribute("min", "1");
		expect(input).toHaveAttribute("max", "16");
	});

	it("reveals and re-masks a password value", () => {
		render(
			<Input
				value="hunter2"
				onChange={vi.fn()}
				type="password"
				aria-label="API token"
			/>,
		);
		const input = screen.getByLabelText("API token");
		expect(input).toHaveAttribute("type", "password");

		fireEvent.click(screen.getByRole("button", { name: "Show value" }));
		expect(input).toHaveAttribute("type", "text");

		fireEvent.click(screen.getByRole("button", { name: "Hide value" }));
		expect(input).toHaveAttribute("type", "password");
	});

	it("honors a changed input type after revealing a password", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<Input
				value="8"
				onChange={onChange}
				type="password"
				aria-label="Value"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Show value" }));

		rerender(
			<Input value="8" onChange={onChange} type="number" aria-label="Value" />,
		);
		expect(screen.getByRole("spinbutton", { name: "Value" })).toHaveValue(8);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("does not submit a form when revealing a password", () => {
		const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) =>
			event.preventDefault(),
		);
		render(
			<form onSubmit={onSubmit}>
				<Input
					value="secret"
					onChange={vi.fn()}
					type="password"
					aria-label="Token"
				/>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Show value" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Token")).toHaveValue("secret");
	});

	it("disables the reveal toggle with the input", () => {
		render(
			<Input
				value=""
				onChange={vi.fn()}
				type="password"
				disabled
				aria-label="API token"
			/>,
		);
		expect(screen.getByRole("button", { name: "Show value" })).toBeDisabled();
	});

	it("forwards className and style to the root element", () => {
		render(
			<Input
				value=""
				onChange={vi.fn()}
				className="custom-input"
				style={{ width: "200px" }}
				aria-label="Region"
			/>,
		);
		const root = screen
			.getByRole("textbox", { name: "Region" })
			.closest(".ui-input");
		expect(root).toHaveClass("custom-input");
		expect(root).toHaveStyle({ width: "200px" });
	});
});
