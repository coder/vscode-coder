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
