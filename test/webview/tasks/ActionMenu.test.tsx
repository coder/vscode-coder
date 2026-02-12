import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	ActionMenu,
	type ActionMenuItem,
} from "@repo/tasks/components/ActionMenu";

import { qs } from "../helpers";

type ActionMenuAction = Exclude<ActionMenuItem, { separator: true }>;

function items(): ActionMenuItem[] {
	return [
		{ label: "Edit", icon: "edit", onClick: vi.fn() },
		{ label: "Copy", icon: "copy", onClick: vi.fn() },
		{ separator: true },
		{ label: "Delete", icon: "trash", onClick: vi.fn(), danger: true },
	];
}

function openMenu(container: HTMLElement): void {
	fireEvent.click(qs(container, "vscode-icon"));
}

function getDropdown(container: HTMLElement): Element | null {
	return container.querySelector(".action-menu-dropdown");
}

describe("ActionMenu", () => {
	it("is closed by default", () => {
		const { container } = render(<ActionMenu items={items()} />);
		expect(getDropdown(container)).not.toBeInTheDocument();
	});

	it("opens on trigger click", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		expect(getDropdown(container)).toBeInTheDocument();
	});

	it("toggles closed on second trigger click", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		openMenu(container);
		expect(getDropdown(container)).not.toBeInTheDocument();
	});

	it("renders items and separators", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		expect(screen.queryByText("Edit")).toBeInTheDocument();
		expect(screen.queryByText("Copy")).toBeInTheDocument();
		expect(screen.queryByText("Delete")).toBeInTheDocument();
		expect(screen.queryByRole("separator")).toBeInTheDocument();
	});

	it("calls onClick and closes on item click", () => {
		const menuItems = items();
		const { container } = render(<ActionMenu items={menuItems} />);
		openMenu(container);
		fireEvent.click(screen.getByText("Edit"));
		const editItem = menuItems[0] as ActionMenuAction;
		expect(editItem.onClick).toHaveBeenCalled();
		expect(getDropdown(container)).not.toBeInTheDocument();
	});

	it("shows spinner instead of icon when loading", () => {
		const { container } = render(
			<ActionMenu
				items={[
					{ label: "Saving", icon: "save", onClick: vi.fn(), loading: true },
				]}
			/>,
		);
		openMenu(container);
		const dropdown = qs(container, ".action-menu-dropdown");
		expect(dropdown.querySelector("vscode-progress-ring")).toBeInTheDocument();
		expect(dropdown.querySelector("vscode-icon")).not.toBeInTheDocument();
	});

	interface DisabledItemTestCase {
		name: string;
		item: ActionMenuItem;
	}

	it.each<DisabledItemTestCase>([
		{
			name: "loading",
			item: {
				label: "Saving",
				icon: "saving",
				onClick: vi.fn(),
				loading: true,
			},
		},
		{
			name: "disabled",
			item: { label: "Noop", icon: "noop", onClick: vi.fn(), disabled: true },
		},
	])("disables $name item", ({ item }) => {
		const { container } = render(<ActionMenu items={[item]} />);
		openMenu(container);
		const button = screen.getByRole<HTMLButtonElement>("button", {
			name: (item as ActionMenuAction).label,
		});
		expect(button).toBeDisabled();
	});

	it("applies danger class to danger items", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		const deleteButton = screen.getByRole("button", { name: "Delete" });
		expect(deleteButton).toHaveClass("danger");
	});

	interface CloseTriggerTestCase {
		name: string;
		trigger: () => void;
	}

	it.each<CloseTriggerTestCase>([
		{ name: "outside mousedown", trigger: () => fireEvent.mouseDown(document) },
		{ name: "scroll", trigger: () => fireEvent.scroll(window) },
	])("closes on $name", ({ trigger }) => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		trigger();
		expect(getDropdown(container)).not.toBeInTheDocument();
	});

	it("closes on Escape key", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		const dropdown = getDropdown(container)!;
		fireEvent.keyDown(dropdown, { key: "Escape" });
		expect(getDropdown(container)).not.toBeInTheDocument();
	});

	it("does not fire onClick on loading item click", () => {
		const onClick = vi.fn();
		const { container } = render(
			<ActionMenu
				items={[{ label: "Saving", icon: "saving", onClick, loading: true }]}
			/>,
		);
		openMenu(container);
		fireEvent.click(screen.getByText("Saving"));
		expect(onClick).not.toHaveBeenCalled();
	});
});
