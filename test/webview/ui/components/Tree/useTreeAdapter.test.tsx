import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { useTreeAdapter } from "@repo/ui/components/Tree/useTreeAdapter";

function ControlledTreeController(): React.JSX.Element {
	const [selectedItemIds, setSelectedItemIds] = useState<readonly string[]>([
		"one",
	]);
	const treeRef = useRef<HTMLDivElement>(null);
	const adapter = useTreeAdapter({
		nodes: [
			{ id: "one", label: "One" },
			{ id: "two", label: "Two" },
			{ id: "three", label: "Three" },
		],
		expandedIds: [],
		expandMode: "singleClick",
		multiSelect: true,
		multiSelectModifier: "ctrlCmd",
		selectedItemIds,
		onSelectedItemsChange: setSelectedItemIds,
		treeRef,
	});

	return (
		<div ref={treeRef} role="tree" tabIndex={0} onKeyDown={adapter.onKeyDown}>
			<output data-testid="tab-stop">{adapter.tabStopId}</output>
			<output data-testid="selection">{selectedItemIds.join(",")}</output>
			{adapter.model.visibleRows.map((row) => (
				<div key={row.node.id} data-tree-id={row.node.id} />
			))}
		</div>
	);
}

describe("useTreeAdapter", () => {
	it("keeps the Shift+Arrow target as the tab target after the selection echo", () => {
		render(<ControlledTreeController />);
		const one = document.querySelector<HTMLElement>('[data-tree-id="one"]');
		if (!one) throw new Error("Expected the first row.");

		fireEvent.keyDown(one, { key: "ArrowDown", shiftKey: true });

		expect(screen.getByTestId("selection")).toHaveTextContent("one,two");
		expect(screen.getByTestId("tab-stop")).toHaveTextContent("two");
	});
});
