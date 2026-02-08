import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionMenu, type ActionMenuItem } from "@repo/tasks/components";

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
		expect(getDropdown(container)).toBeNull();
	});

	it("opens on trigger click", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		expect(getDropdown(container)).not.toBeNull();
	});

	it("toggles closed on second trigger click", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		openMenu(container);
		expect(getDropdown(container)).toBeNull();
	});

	it("renders items and separators", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		expect(screen.getByText("Edit")).not.toBeNull();
		expect(screen.getByText("Copy")).not.toBeNull();
		expect(screen.getByText("Delete")).not.toBeNull();
		expect(screen.getByRole("separator")).not.toBeNull();
	});

	it("calls onClick and closes on item click", () => {
		const menuItems = items();
		const { container } = render(<ActionMenu items={menuItems} />);
		openMenu(container);
		fireEvent.click(screen.getByText("Edit"));
		const editItem = menuItems[0] as ActionMenuAction;
		expect(editItem.onClick).toHaveBeenCalled();
		expect(getDropdown(container)).toBeNull();
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
		expect(dropdown.querySelector("vscode-progress-ring")).not.toBeNull();
		expect(dropdown.querySelector("vscode-icon")).toBeNull();
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
		expect(button.disabled).toBe(true);
	});

	it("applies danger class to danger items", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		const deleteButton = screen.getByRole("button", { name: "Delete" });
		expect(deleteButton.classList).toContain("danger");
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
		expect(getDropdown(container)).toBeNull();
	});

	it("closes on Escape key", () => {
		const { container } = render(<ActionMenu items={items()} />);
		openMenu(container);
		const dropdown = getDropdown(container)!;
		fireEvent.keyDown(dropdown, { key: "Escape" });
		expect(getDropdown(container)).toBeNull();
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
