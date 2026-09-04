import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Field, Input, Label } from "@repo/ui";

describe("Label", () => {
	it("labels a control through htmlFor", () => {
		render(
			<>
				<Label htmlFor="region">Region</Label>
				<input id="region" />
			</>,
		);
		expect(screen.getByLabelText("Region")).toBeInTheDocument();
	});
});

describe("Field", () => {
	it("wires its label to the control and renders the description", () => {
		render(
			<Field label="Region" htmlFor="region" description="Pick one.">
				<Input id="region" value="" onChange={vi.fn()} />
			</Field>,
		);
		expect(screen.getByLabelText("Region")).toBeInTheDocument();
		expect(screen.getByText("Pick one.")).toHaveClass("ui-field__description");
	});

	it("associates description and error text with a nested native control", () => {
		render(
			<Field
				label="Cores"
				htmlFor="cores"
				description="Choose between 1 and 16."
				descriptionId="cores-description"
				error="Out of range."
				errorId="cores-error"
			>
				<div>
					<input
						id="cores"
						aria-describedby="cores-description cores-error"
						aria-invalid="true"
					/>
				</div>
			</Field>,
		);
		const control = screen.getByRole("textbox", { name: "Cores" });
		expect(control).toHaveAccessibleDescription(
			"Choose between 1 and 16. Out of range.",
		);
		expect(control).toBeInvalid();
	});

	it("allows the consumer to remove an error without losing the description", () => {
		const renderField = (invalid: boolean): React.JSX.Element => (
			<Field
				label="Region"
				htmlFor="region"
				description="Pick one."
				descriptionId="region-description"
				error={invalid ? "Unavailable." : undefined}
				errorId="region-error"
			>
				<Input
					id="region"
					value=""
					onChange={vi.fn()}
					aria-describedby={
						invalid ? "region-description region-error" : "region-description"
					}
					aria-invalid={invalid}
				/>
			</Field>
		);
		const { rerender } = render(renderField(true));
		const control = screen.getByRole("textbox", { name: "Region" });
		expect(control).toHaveAccessibleDescription("Pick one. Unavailable.");
		expect(control).toBeInvalid();

		rerender(renderField(false));
		expect(control).toHaveAccessibleDescription("Pick one.");
		expect(control).toBeValid();
		expect(screen.queryByText("Unavailable.")).not.toBeInTheDocument();
	});

	it("renders error text", () => {
		render(
			<Field label="Cores" error="Out of range.">
				<input />
			</Field>,
		);
		expect(screen.getByText("Out of range.")).toHaveClass("ui-field__error");
	});

	it("forwards className and style to the root element", () => {
		render(
			<Field className="custom-field" style={{ width: "200px" }}>
				<input />
			</Field>,
		);
		const root = screen.getByRole("textbox").closest(".ui-field");
		expect(root).toHaveClass("custom-field");
		expect(root).toHaveStyle({ width: "200px" });
	});
});
