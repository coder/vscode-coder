import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	Checkbox,
	Field,
	Input,
	PasswordInput,
	SearchInput,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@repo/ui";

import { qs } from "../helpers";

const ROOT_STYLING = { className: "custom-root", style: { width: "200px" } };

interface TextControlCase {
	name: string;
	role: string;
	control: (
		value: string,
		onChange: (value: string) => void,
	) => React.JSX.Element;
}

describe("text controls", () => {
	it.each<TextControlCase>([
		{
			name: "Input",
			role: "textbox",
			control: (value, onChange) => (
				<Input value={value} onChange={onChange} aria-label="Region" />
			),
		},
		{
			name: "Textarea",
			role: "textbox",
			control: (value, onChange) => (
				<Textarea value={value} onChange={onChange} aria-label="Region" />
			),
		},
		{
			name: "SearchInput",
			role: "searchbox",
			control: (value, onChange) => (
				<SearchInput value={value} onChange={onChange} />
			),
		},
	])("$name reports changes without owning the value", ({ role, control }) => {
		const onChange = vi.fn();
		const { rerender } = render(control("", onChange));
		fireEvent.change(screen.getByRole(role), { target: { value: "next" } });
		expect(onChange).toHaveBeenCalledWith("next");
		expect(screen.getByRole(role)).toHaveValue("");

		rerender(control("next", onChange));
		expect(screen.getByRole(role)).toHaveValue("next");
	});
});

interface RootStylingCase {
	name: string;
	root: string;
	ui: React.JSX.Element;
}

describe("root styling", () => {
	it.each<RootStylingCase>([
		{
			name: "Input",
			root: ".ui-input",
			ui: (
				<Input
					value=""
					onChange={vi.fn()}
					aria-label="Region"
					{...ROOT_STYLING}
				/>
			),
		},
		{
			name: "Textarea",
			root: ".ui-textarea",
			ui: (
				<Textarea
					value=""
					onChange={vi.fn()}
					aria-label="Region"
					{...ROOT_STYLING}
				/>
			),
		},
		{
			name: "SearchInput",
			root: ".ui-search-input",
			ui: <SearchInput value="" onChange={vi.fn()} {...ROOT_STYLING} />,
		},
		{
			name: "Checkbox",
			root: ".ui-checkbox",
			ui: (
				<Checkbox checked={false} onChange={vi.fn()} {...ROOT_STYLING}>
					Styled
				</Checkbox>
			),
		},
		{
			name: "Field",
			root: ".ui-field",
			ui: (
				<Field {...ROOT_STYLING}>
					<input />
				</Field>
			),
		},
		{
			name: "SelectTrigger",
			root: ".ui-select__trigger",
			ui: (
				<Select>
					<SelectTrigger aria-label="Region" {...ROOT_STYLING}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="one">One</SelectItem>
					</SelectContent>
				</Select>
			),
		},
	])("$name forwards className and style", ({ root, ui }) => {
		const { container } = render(ui);
		expect(qs(container, root)).toHaveClass(ROOT_STYLING.className);
		expect(qs(container, root)).toHaveStyle(ROOT_STYLING.style);
	});
});

describe("PasswordInput", () => {
	it("reveals and re-masks the value, and disables the toggle with the input", () => {
		const renderInput = (disabled?: boolean): React.JSX.Element => (
			<PasswordInput
				value="hunter2"
				onChange={vi.fn()}
				aria-label="API token"
				disabled={disabled}
			/>
		);
		const { rerender } = render(renderInput());
		const input = screen.getByLabelText("API token");
		expect(input).toHaveAttribute("type", "password");
		fireEvent.click(screen.getByRole("button", { name: "Show value" }));
		expect(input).toHaveAttribute("type", "text");
		fireEvent.click(screen.getByRole("button", { name: "Hide value" }));
		expect(input).toHaveAttribute("type", "password");

		rerender(renderInput(true));
		expect(screen.getByRole("button", { name: "Show value" })).toBeDisabled();
	});
});

describe("SearchInput", () => {
	it("clears through the same callback and returns focus after rerender", () => {
		const onChange = vi.fn();
		const ControlledSearch = (): React.JSX.Element => {
			const [value, setValue] = useState("prod");
			return (
				<SearchInput
					value={value}
					onChange={(nextValue) => {
						onChange(nextValue);
						setValue(nextValue);
					}}
				/>
			);
		};
		render(<ControlledSearch />);
		fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
		expect(onChange).toHaveBeenCalledWith("");
		expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus();
	});

	it("exposes the input through a consumer ref alongside the internal one", () => {
		const ref = createRef<HTMLInputElement>();
		render(<SearchInput value="prod" onChange={vi.fn()} ref={ref} />);
		expect(ref.current).toBe(screen.getByRole("searchbox", { name: "Search" }));

		fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
		expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus();
	});
});

describe("Checkbox", () => {
	it("reports toggles from the box and its label without owning the checked state", () => {
		const onChange = vi.fn();
		const renderCheckbox = (props: {
			checked: boolean;
			disabled?: boolean;
		}) => (
			<Checkbox onChange={onChange} {...props}>
				Start on connect
			</Checkbox>
		);
		const { rerender } = render(renderCheckbox({ checked: false }));
		const checkbox = screen.getByRole("checkbox", { name: "Start on connect" });

		fireEvent.click(checkbox);
		expect(onChange).toHaveBeenCalledWith(true);
		expect(checkbox).not.toBeChecked();

		rerender(renderCheckbox({ checked: true }));
		expect(checkbox).toBeChecked();
		fireEvent.click(screen.getByText("Start on connect"));
		expect(onChange).toHaveBeenCalledWith(false);

		rerender(renderCheckbox({ checked: true, disabled: true }));
		fireEvent.click(screen.getByText("Start on connect"));
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

describe("Field", () => {
	it("labels the control and describes it with description and error text", () => {
		const renderField = (error?: string): React.JSX.Element => (
			<Field
				label="Cores"
				htmlFor="cores"
				description="Choose between 1 and 16."
				descriptionId="cores-description"
				error={error}
				errorId="cores-error"
			>
				<input id="cores" aria-describedby="cores-description cores-error" />
			</Field>
		);
		const { rerender } = render(renderField("Out of range."));
		const control = screen.getByRole("textbox", { name: "Cores" });
		expect(control).toHaveAccessibleDescription(
			"Choose between 1 and 16. Out of range.",
		);

		rerender(renderField());
		expect(control).toHaveAccessibleDescription("Choose between 1 and 16.");
	});
});

const RegionSelect = (
	props: ComponentProps<typeof Select>,
): React.JSX.Element => (
	<Select {...props}>
		<SelectTrigger aria-label="Region">
			<SelectValue placeholder="Select a region" />
		</SelectTrigger>
		<SelectContent>
			<SelectItem
				value="us-pittsburgh"
				description="Lowest latency"
				aria-describedby="hint"
			>
				US East
			</SelectItem>
			<SelectItem value="eu-helsinki" disabled>
				EU North
			</SelectItem>
			<SelectItem value="ap-sydney">Asia Pacific</SelectItem>
		</SelectContent>
	</Select>
);

describe("Select", () => {
	it("opens with the keyboard, marks disabled options, and reports the selected value", () => {
		const onValueChange = vi.fn();
		const { rerender } = render(
			<RegionSelect value="" onValueChange={onValueChange} />,
		);
		const trigger = screen.getByRole("combobox", { name: "Region" });
		expect(trigger).toHaveTextContent("Select a region");

		fireEvent.keyDown(trigger, { key: "Enter" });
		expect(screen.getByRole("option", { name: "EU North" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		fireEvent.keyDown(screen.getByRole("option", { name: "US East" }), {
			key: "Enter",
		});
		expect(onValueChange).toHaveBeenCalledWith("us-pittsburgh");

		rerender(<RegionSelect value="ap-sydney" onValueChange={onValueChange} />);
		expect(trigger).toHaveTextContent("Asia Pacific");
	});

	it("describes options with their description text alongside consumer ids", () => {
		render(
			<>
				<span id="hint">Available now.</span>
				<RegionSelect defaultOpen />
			</>,
		);
		expect(
			screen.getByRole("option", { name: "US East" }),
		).toHaveAccessibleDescription("Available now. Lowest latency");
		expect(
			screen.getByRole("option", { name: "Asia Pacific" }),
		).not.toHaveAttribute("aria-describedby");
	});
});
