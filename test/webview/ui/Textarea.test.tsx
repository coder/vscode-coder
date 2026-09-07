import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "@repo/ui";

import {
	expectControlledText,
	expectRootStyling,
	rootStyling,
} from "./helpers";

describe("Textarea", () => {
	it("reports changes without owning the value", () => {
		expectControlledText({
			renderControl: (value, onChange) => (
				<Textarea value={value} onChange={onChange} aria-label="Init script" />
			),
			getControl: () => screen.getByRole("textbox", { name: "Init script" }),
			typed: "echo hi",
		});
	});

	it("disables the native control", () => {
		render(
			<Textarea value="" onChange={vi.fn()} disabled aria-label="Disabled" />,
		);
		expect(screen.getByRole("textbox", { name: "Disabled" })).toBeDisabled();
	});

	it("forwards className and style to the root element", () => {
		expectRootStyling(
			<Textarea
				value=""
				onChange={vi.fn()}
				aria-label="Init script"
				{...rootStyling}
			/>,
			() =>
				screen
					.getByRole("textbox", { name: "Init script" })
					.closest(".ui-textarea"),
		);
	});
});
