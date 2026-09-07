import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@repo/ui";

import {
	expectControlledText,
	expectRootStyling,
	rootStyling,
} from "./helpers";

import type { SubmitEvent } from "react";

describe("Input", () => {
	it("reports changes without owning the value", () => {
		expectControlledText({
			renderControl: (value, onChange) => (
				<Input value={value} onChange={onChange} aria-label="Region" />
			),
			getControl: () => screen.getByRole("textbox", { name: "Region" }),
			typed: "us",
		});
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

	it("reveals and re-masks a password without submitting the surrounding form", () => {
		const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) =>
			event.preventDefault(),
		);
		render(
			<form onSubmit={onSubmit}>
				<Input
					value="hunter2"
					onChange={vi.fn()}
					type="password"
					aria-label="API token"
				/>
			</form>,
		);
		const input = screen.getByLabelText("API token");
		expect(input).toHaveAttribute("type", "password");

		fireEvent.click(screen.getByRole("button", { name: "Show value" }));
		expect(input).toHaveAttribute("type", "text");

		fireEvent.click(screen.getByRole("button", { name: "Hide value" }));
		expect(input).toHaveAttribute("type", "password");
		expect(input).toHaveValue("hunter2");
		expect(onSubmit).not.toHaveBeenCalled();
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

	it("forwards className and style to the root element", () => {
		expectRootStyling(
			<Input
				value=""
				onChange={vi.fn()}
				aria-label="Region"
				{...rootStyling}
			/>,
			() =>
				screen.getByRole("textbox", { name: "Region" }).closest(".ui-input"),
		);
	});
});
