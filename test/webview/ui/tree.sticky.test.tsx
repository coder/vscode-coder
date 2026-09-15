import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tree } from "@repo/ui";

import { BASIC_NODES } from "./treeTestHelpers";

describe("Tree sticky scroll", () => {
	it("renders an empty sticky anchor before scrolling", () => {
		render(
			<Tree
				aria-label="Sticky"
				stickyScroll
				nodes={BASIC_NODES}
				expandedIds={["parent"]}
			/>,
		);
		expect(document.querySelector(".ui-tree-sticky")).not.toBeNull();
		expect(document.querySelector(".ui-tree-sticky__rows")).toBeNull();
	});
	it("preserves pinned pointer, focus, and accessibility behavior", () => {
		const onExpandedIdsChange = vi.fn();
		const onSelectedItemChange = vi.fn();
		render(
			<div data-testid="scroller" style={{ overflowY: "auto" }}>
				<Tree
					aria-label="Sticky"
					stickyScroll
					nodes={[
						{
							id: "alpha",
							label: "alpha",
							children: [
								{
									id: "src",
									label: "src",
									children: Array.from({ length: 5 }, (_, index) => ({
										id: `file-${index}`,
										label: `file-${index}`,
									})),
								},
							],
						},
					]}
					expandedIds={["alpha", "src"]}
					onExpandedIdsChange={onExpandedIdsChange}
					onSelectedItemChange={onSelectedItemChange}
				/>
			</div>,
		);
		const scroller = screen.getByTestId("scroller");
		Object.defineProperty(scroller, "clientHeight", { value: 10 * 22 });
		const widget = document.querySelector<HTMLElement>(".ui-tree-sticky");
		if (!widget?.parentElement) throw new Error("Expected the sticky widget.");
		widget.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
		widget.parentElement.getBoundingClientRect = () =>
			({ top: -66 }) as DOMRect;
		Object.assign(scroller, { scrollBy: vi.fn() });
		fireEvent.scroll(scroller);
		const pinned = [
			...document.querySelectorAll(".ui-tree-sticky .ui-tree-item"),
		];
		expect(pinned.map((row) => row.textContent)).toEqual(["alpha", "src"]);
		expect(document.querySelector(".ui-tree-sticky__shadow")).not.toBeNull();
		expect(widget).not.toHaveAttribute("aria-hidden");
		expect(widget).toHaveAttribute("tabindex", "0");
		expect(pinned[0]).toHaveAttribute("role", "treeitem");
		expect(pinned[0]).toHaveAccessibleName("alpha");
		expect(pinned[0]).toHaveAttribute("aria-level", "1");
		expect(pinned[0]).toHaveAttribute("aria-posinset", "1");
		expect(pinned[0]).toHaveAttribute("aria-setsize", "1");
		expect(pinned[0]).toHaveAttribute("aria-selected", "false");
		expect(pinned[1]).toHaveAttribute("aria-expanded", "true");
		const twistie = pinned[1]?.querySelector(".ui-tree-item__chevron");
		expect(twistie).not.toBeNull();
		fireEvent.click(twistie!);
		expect(onExpandedIdsChange).toHaveBeenCalledWith(["alpha"]);
		expect(onSelectedItemChange).toHaveBeenCalledOnce();
		expect(onSelectedItemChange).toHaveBeenCalledWith("src");
		onSelectedItemChange.mockClear();
		fireEvent.click(pinned[0]);
		expect(onSelectedItemChange).toHaveBeenCalledOnce();
		expect(onSelectedItemChange).toHaveBeenCalledWith("alpha");
		expect(onExpandedIdsChange).toHaveBeenCalledOnce();
		const realAlpha = document.querySelector<HTMLElement>(
			'[data-tree-id="alpha"]',
		);
		expect(screen.getByRole("tree")).toHaveAttribute(
			"aria-activedescendant",
			realAlpha?.id,
		);
		expect(document.activeElement).toBe(screen.getByRole("tree"));
		vi.mocked(scroller.scrollBy).mockClear();
		fireEvent.click(pinned[0], { ctrlKey: true });
		expect(scroller.scrollBy).toHaveBeenCalledOnce();
	});
});
