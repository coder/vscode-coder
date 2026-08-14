import { ROW_HEIGHT_PX, type TreeRowModel } from "../treeModel";

/** VS Code caps the sticky widget at 40% of the viewport. */
const MAX_VIEWPORT_RATIO = 0.4;

export interface StickyState {
	/** Ids of the pinned ancestor chain, outermost first. */
	readonly ids: readonly string[];
	/** Upward shift in px while the last pinned subtree scrolls out. */
	readonly pushOffset: number;
}

export const NO_STICKY: StickyState = { ids: [], pushOffset: 0 };

/**
 * The ancestor chain to pin, like VS Code's findStickyState: the ancestors
 * of the topmost row not covered by the widget, capped by `maxCount` and by
 * viewport share. Pinned rows cover rows below, which can deepen the chain,
 * so grow to a fixpoint.
 */
export function computeStickyState(
	rows: readonly TreeRowModel[],
	scrolledPx: number,
	viewportPx: number,
	maxCount: number,
): StickyState {
	const cap = Math.min(
		maxCount,
		Math.floor((viewportPx * MAX_VIEWPORT_RATIO) / ROW_HEIGHT_PX),
	);
	if (scrolledPx <= 0 || cap <= 0) {
		return NO_STICKY;
	}
	const topIndex = Math.floor(scrolledPx / ROW_HEIGHT_PX);
	let count = 0;
	let chain: readonly string[] = [];
	for (;;) {
		const rowChain = rows[topIndex + count]?.pathIds ?? [];
		const next = Math.min(rowChain.length, cap);
		if (next <= count) {
			break;
		}
		count = next;
		chain = rowChain;
	}
	const ids = chain.slice(0, count);
	if (ids.length === 0) {
		return NO_STICKY;
	}
	return { ids, pushOffset: pushOffset(rows, scrolledPx, ids) };
}

/** How far the widget shifts up as the last pinned subtree ends. */
function pushOffset(
	rows: readonly TreeRowModel[],
	scrolledPx: number,
	ids: readonly string[],
): number {
	const lastId = ids.at(-1);
	let endIndex = -1;
	rows.forEach((row, index) => {
		if (row.node.id === lastId || row.pathIds.includes(lastId ?? "")) {
			endIndex = index;
		}
	});
	if (endIndex === -1) {
		return 0;
	}
	const subtreeBottom = (endIndex + 1) * ROW_HEIGHT_PX;
	const widgetBottom = scrolledPx + ids.length * ROW_HEIGHT_PX;
	return Math.min(0, subtreeBottom - widgetBottom);
}
