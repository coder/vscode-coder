import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Field, Input, Label } from "@repo/ui";

import { expectRootStyling, rootStyling } from "./helpers";

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
	it("wires its label to the control and renders description and error text", () => {
		render(
			<Field
				label="Region"
				htmlFor="region"
				description="Pick one."
				error="Unavailable."
			>
				<Input id="region" value="" onChange={vi.fn()} />
			</Field>,
		);
		expect(screen.getByLabelText("Region")).toBeInTheDocument();
		expect(screen.getByText("Pick one.")).toHaveClass("ui-field__description");
		expect(screen.getByText("Unavailable.")).toHaveClass("ui-field__error");
	});

	it("associates description and error text with a nested native control until the consumer removes the error", () => {
		const renderField = (invalid: boolean): React.JSX.Element => (
			<Field
				label="Cores"
				htmlFor="cores"
				description="Choose between 1 and 16."
				descriptionId="cores-description"
				error={invalid ? "Out of range." : undefined}
				errorId="cores-error"
			>
				<div>
					<input
						id="cores"
						aria-describedby={
							invalid ? "cores-description cores-error" : "cores-description"
						}
						aria-invalid={invalid}
					/>
				</div>
			</Field>
		);
		const { rerender } = render(renderField(true));
		const control = screen.getByRole("textbox", { name: "Cores" });
		expect(control).toHaveAccessibleDescription(
			"Choose between 1 and 16. Out of range.",
		);
		expect(control).toBeInvalid();

		rerender(renderField(false));
		expect(control).toHaveAccessibleDescription("Choose between 1 and 16.");
		expect(control).toBeValid();
		expect(screen.queryByText("Out of range.")).not.toBeInTheDocument();
	});

	it("forwards className and style to the root element", () => {
		expectRootStyling(
			<Field {...rootStyling}>
				<input />
			</Field>,
			() => screen.getByRole("textbox").closest(".ui-field"),
		);
	});
});
